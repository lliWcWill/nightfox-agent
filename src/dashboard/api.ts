import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getCachedUsage } from '../claude/agent.js';
import { config } from '../config.js';
import { jobRunner } from '../jobs/index.js';
import { objectiveStore } from '../autonomy/index.js';
import { cancelObjectiveById } from '../cancel/cancellation-coordinator.js';
import type {
  DashboardTask,
  AgentStatusInfo,
  QueueInfo,
  DashboardJobInfo,
  FleetSummary,
} from './types.js';
import { ensureHomeStateDir, getHomeStatePath, resolveExistingHomeStatePath } from '../utils/app-paths.js';

// ── In-memory agent status (updated by eventBus listeners in server.ts) ──

export const agentStatuses: Map<string, AgentStatusInfo> = new Map([
  ['claude', { id: 'claude', status: 'ready', model: 'opus' }],
  ['gemini', { id: 'gemini', status: 'offline' }],
  ['droid', { id: 'droid', status: 'offline' }],
  ['groq', { id: 'groq', status: 'ready' }],
]);

export const queueStates: Map<number, QueueInfo> = new Map();

// ── Task storage ────────────────────────────────────────────────────

const TASKS_FILE = getHomeStatePath('dashboard-tasks.json');
const TASKS_LOAD_FILE = resolveExistingHomeStatePath('dashboard-tasks.json');

function loadTasks(): DashboardTask[] {
  if (!existsSync(TASKS_LOAD_FILE)) return [];
  try {
    return JSON.parse(readFileSync(TASKS_LOAD_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTasks(tasks: DashboardTask[]): void {
  ensureHomeStateDir();
  writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

function listQueues(): QueueInfo[] {
  return [...queueStates.values()]
    .filter((queue) => queue.depth > 0 || queue.isProcessing)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function snapshotToJobInfo(limit = 50): DashboardJobInfo[] {
  return jobRunner.listRecent(limit).map((job) => ({
    jobId: job.jobId,
    name: job.name,
    lane: job.lane,
    state: job.state,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    parentJobId: job.parentJobId,
    rootJobId: job.rootJobId,
    progress: job.progress,
    resultSummary: job.resultSummary,
    error: job.error,
    origin: job.origin
      ? {
          channelId: job.origin.channelId,
          threadId: job.origin.threadId,
          userId: job.origin.userId,
        }
      : undefined,
  }));
}

function buildFleetSummary(): FleetSummary {
  const recent = snapshotToJobInfo(100);
  return {
    generatedAt: Date.now(),
    agents: [...agentStatuses.values()],
    queues: listQueues(),
    jobs: {
      metrics: jobRunner.getMetrics(),
      active: recent.filter((job) => job.state === 'queued' || job.state === 'running'),
      recent,
    },
    config: {
      botName: config.BOT_NAME,
      botMode: config.BOT_MODE,
      dashboardPort: config.DASHBOARD_PORT,
      dangerousMode: config.DANGEROUS_MODE,
    },
  };
}

export function recordQueueEnqueue(params: {
  chatId: number;
  queueDepth: number;
  message?: string;
  timestamp: number;
}) {
  const current = queueStates.get(params.chatId);
  queueStates.set(params.chatId, {
    chatId: params.chatId,
    depth: Math.max(0, params.queueDepth),
    isProcessing: current?.isProcessing ?? false,
    lastMessage: params.message ?? current?.lastMessage,
    updatedAt: params.timestamp,
  });
}

export function recordQueueProcessing(params: {
  chatId: number;
  isProcessing: boolean;
  timestamp: number;
}) {
  const current = queueStates.get(params.chatId);
  queueStates.set(params.chatId, {
    chatId: params.chatId,
    depth: current?.depth ?? 0,
    isProcessing: params.isProcessing,
    lastMessage: current?.lastMessage,
    updatedAt: params.timestamp,
  });
}

export function recordQueueDequeue(params: {
  chatId: number;
  timestamp: number;
}) {
  const current = queueStates.get(params.chatId);
  const nextDepth = Math.max(0, (current?.depth ?? 1) - 1);
  const next: QueueInfo = {
    chatId: params.chatId,
    depth: nextDepth,
    isProcessing: current?.isProcessing ?? false,
    lastMessage: current?.lastMessage,
    updatedAt: params.timestamp,
  };
  if (next.depth === 0 && !next.isProcessing) {
    queueStates.delete(params.chatId);
    return;
  }
  queueStates.set(params.chatId, next);
}

const MAX_BODY = 1024 * 1024;

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY) { req.destroy(); reject(new Error('Body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse): void {
  json(res, { error: 'Not found' }, 404);
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }

  if (!path.startsWith('/api/')) return false;

  if (path === '/api/sessions' && method === 'GET') {
    const sessions: Record<string, unknown>[] = [];
    json(res, { sessions });
    return true;
  }

  if (path === '/api/agents/status' && method === 'GET') {
    json(res, { agents: [...agentStatuses.values()] });
    return true;
  }

  if (path === '/api/queue' && method === 'GET') {
    json(res, { queues: listQueues() });
    return true;
  }

  if (path === '/api/jobs' && method === 'GET') {
    const limitRaw = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;
    const state = url.searchParams.get('state');
    const jobs = snapshotToJobInfo(limit).filter((job) => (state ? job.state === state : true));
    json(res, { jobs, metrics: jobRunner.getMetrics() });
    return true;
  }

  const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && method === 'GET') {
    const snap = jobRunner.get(jobMatch[1]);
    if (!snap) {
      notFound(res);
      return true;
    }
    json(res, {
      job: {
        jobId: snap.jobId,
        name: snap.name,
        lane: snap.lane,
        state: snap.state,
        createdAt: snap.createdAt,
        startedAt: snap.startedAt,
        endedAt: snap.endedAt,
        parentJobId: snap.parentJobId,
        rootJobId: snap.rootJobId,
        progress: snap.progress,
        resultSummary: snap.resultSummary,
        error: snap.error,
        origin: snap.origin,
      },
    });
    return true;
  }

  if (path === '/api/objectives' && method === 'GET') {
    const state = url.searchParams.get('state');
    const mode = url.searchParams.get('mode');
    const chatIdParam = url.searchParams.get('chatId');
    const parsedChatId = chatIdParam ? parseInt(chatIdParam, 10) : null;
    const objectives = objectiveStore.list().filter((objective) => (
      (state ? objective.state === state : true)
      && (mode ? objective.mode === mode : true)
      && (parsedChatId !== null && Number.isFinite(parsedChatId) ? objective.chatId === parsedChatId : true)
    ));
    json(res, { objectives });
    return true;
  }

  const objectiveCancelMatch = path.match(/^\/api\/objectives\/([^/]+)\/cancel$/);
  if (objectiveCancelMatch && method === 'POST') {
    const canceled = await cancelObjectiveById(objectiveCancelMatch[1]);
    if (!canceled) {
      notFound(res);
      return true;
    }
    json(res, { objective: canceled.objective, canceled: true, cancelledJobs: canceled.cancelledJobs });
    return true;
  }

  const objectiveMatch = path.match(/^\/api\/objectives\/([^/]+)$/);
  if (objectiveMatch && method === 'GET') {
    const objective = objectiveStore.get(objectiveMatch[1]);
    if (!objective) {
      notFound(res);
      return true;
    }
    json(res, { objective });
    return true;
  }

  if (path === '/api/fleet/summary' && method === 'GET') {
    json(res, buildFleetSummary());
    return true;
  }

  const usageMatch = path.match(/^\/api\/usage\/(-?\d+)$/);
  if (usageMatch && method === 'GET') {
    const chatId = parseInt(usageMatch[1], 10);
    const usage = getCachedUsage(chatId);
    json(res, { chatId, usage: usage || null });
    return true;
  }

  if (path === '/api/config' && method === 'GET') {
    json(res, {
      botName: config.BOT_NAME,
      botMode: config.BOT_MODE,
      streamingMode: config.STREAMING_MODE,
      dangerousMode: config.DANGEROUS_MODE,
      maxLoopIterations: config.MAX_LOOP_ITERATIONS,
      ttsProvider: config.TTS_PROVIDER,
      ttsVoice: config.TTS_VOICE,
    });
    return true;
  }

  if (path === '/api/voice/sessions' && method === 'GET') {
    json(res, { sessions: [] });
    return true;
  }

  if (path === '/api/tasks' && method === 'POST') {
    const body = await parseBody(req) as Partial<DashboardTask>;
    const tasks = loadTasks();
    const task: DashboardTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: body.title || 'Untitled',
      description: body.description || '',
      status: body.status || 'todo',
      assignedAgent: body.assignedAgent,
      priority: body.priority || 'medium',
      linkedSession: body.linkedSession,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    tasks.push(task);
    saveTasks(tasks);
    json(res, task, 201);
    return true;
  }

  if (path === '/api/tasks' && method === 'GET') {
    json(res, { tasks: loadTasks() });
    return true;
  }

  const taskMatch = path.match(/^\/api\/tasks\/(task_\w+)$/);
  if (taskMatch && method === 'PUT') {
    const taskId = taskMatch[1];
    const body = await parseBody(req) as Partial<DashboardTask>;
    const tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) { notFound(res); return true; }
    tasks[idx] = { ...tasks[idx], ...body, id: taskId, updatedAt: Date.now() };
    saveTasks(tasks);
    json(res, tasks[idx]);
    return true;
  }

  if (taskMatch && method === 'DELETE') {
    const taskId = taskMatch[1];
    const tasks = loadTasks();
    const filtered = tasks.filter(t => t.id !== taskId);
    saveTasks(filtered);
    json(res, { deleted: taskId });
    return true;
  }

  notFound(res);
  return true;
}
