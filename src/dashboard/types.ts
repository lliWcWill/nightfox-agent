import type { JobEvent } from '../jobs/core/job-types.js';
import type { ObjectiveEvent } from '../autonomy/objective-event-store.js';
import type { ObjectiveRecord } from '../autonomy/objective-store.js';

// ── Dashboard shared types ───────────────────────────────────────────

// Agent identifiers
export type AgentId = 'claude' | 'gemini' | 'droid' | 'groq';
export type AgentStatus = 'ready' | 'thinking' | 'error' | 'offline';

// ── Event payloads ───────────────────────────────────────────────────

export interface AgentStartEvent {
  chatId: number;
  model: string;
  prompt: string;
  sessionId?: string;
  timestamp: number;
}

export interface AgentProgressEvent {
  chatId: number;
  text: string;
  timestamp: number;
}

export interface AgentToolStartEvent {
  chatId: number;
  toolName: string;
  callId?: string;
  input?: Record<string, unknown>;
  timestamp: number;
}

export interface AgentToolEndEvent {
  chatId: number;
  toolName: string;
  callId?: string;
  status?: 'completed' | 'error';
  output?: unknown;
  error?: string;
  durationMs?: number;
  timestamp: number;
}

export interface AgentCompleteEvent {
  chatId: number;
  text: string;
  toolsUsed: string[];
  usage?: AgentUsageData;
  durationMs: number;
  timestamp: number;
}

export interface AgentErrorEvent {
  chatId: number;
  error: string;
  timestamp: number;
}

export interface AgentUsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: number;
  contextWindow: number;
  numTurns: number;
  model: string;
}

// Voice events
export interface VoiceOpenEvent {
  guildId: string;
  channelId: string;
  timestamp: number;
}

export interface VoiceCloseEvent {
  guildId: string;
  reason: string;
  timestamp: number;
}

export interface VoiceTextEvent {
  guildId: string;
  text: string;
  timestamp: number;
}

export interface VoiceToolCallEvent {
  guildId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export interface VoiceInterruptedEvent {
  guildId: string;
  timestamp: number;
}

// Droid events
export interface DroidStartEvent {
  prompt: string;
  model: string;
  timestamp: number;
}

export interface DroidStreamEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface DroidCompleteEvent {
  result: string;
  durationMs: number;
  isError: boolean;
  timestamp: number;
}

// Session events
export interface SessionCreateEvent {
  chatId: number;
  conversationId: string;
  workingDirectory: string;
  timestamp: number;
}

export interface SessionUpdateEvent {
  chatId: number;
  conversationId: string;
  claudeSessionId?: string;
  timestamp: number;
}

export interface SessionClearEvent {
  chatId: number;
  timestamp: number;
}

// Queue events
export interface QueueEnqueueEvent {
  chatId: number;
  message: string;
  queueDepth: number;
  timestamp: number;
}

export interface QueueDequeueEvent {
  chatId: number;
  timestamp: number;
}

export interface QueueProcessingEvent {
  chatId: number;
  isProcessing: boolean;
  timestamp: number;
}

type JobQueuedEvent = Extract<JobEvent, { type: 'job:queued' }>;
type JobOriginEvent = Extract<JobEvent, { type: 'job:origin' }>;
type JobIdempotencyEvent = Extract<JobEvent, { type: 'job:idempotency' }>;
type JobStartEvent = Extract<JobEvent, { type: 'job:start' }>;
type JobProgressEvent = Extract<JobEvent, { type: 'job:progress' }>;
type JobLogEvent = Extract<JobEvent, { type: 'job:log' }>;
type JobResultEvent = Extract<JobEvent, { type: 'job:result' }>;
type JobEndEvent = Extract<JobEvent, { type: 'job:end' }>;

// ── Event map ────────────────────────────────────────────────────────

export interface DashboardEventMap {
  'agent:start': AgentStartEvent;
  'agent:progress': AgentProgressEvent;
  'agent:tool_start': AgentToolStartEvent;
  'agent:tool_end': AgentToolEndEvent;
  'agent:complete': AgentCompleteEvent;
  'agent:error': AgentErrorEvent;

  'voice:open': VoiceOpenEvent;
  'voice:close': VoiceCloseEvent;
  'voice:text': VoiceTextEvent;
  'voice:tool_call': VoiceToolCallEvent;
  'voice:interrupted': VoiceInterruptedEvent;

  'droid:start': DroidStartEvent;
  'droid:stream': DroidStreamEvent;
  'droid:complete': DroidCompleteEvent;

  'session:create': SessionCreateEvent;
  'session:update': SessionUpdateEvent;
  'session:clear': SessionClearEvent;

    'queue:enqueue': QueueEnqueueEvent;
    'queue:dequeue': QueueDequeueEvent;
    'queue:processing': QueueProcessingEvent;

  'job:queued': JobQueuedEvent;
  'job:origin': JobOriginEvent;
  'job:idempotency': JobIdempotencyEvent;
  'job:start': JobStartEvent;
  'job:progress': JobProgressEvent;
  'job:log': JobLogEvent;
  'job:result': JobResultEvent;
  'job:end': JobEndEvent;
}

export type DashboardEventType = keyof DashboardEventMap;

// ── WebSocket message envelope ───────────────────────────────────────

export interface WsMessage<T extends DashboardEventType = DashboardEventType> {
  type: T | 'system:hello' | 'system:heartbeat';
  payload: T extends DashboardEventType ? DashboardEventMap[T] : Record<string, unknown>;
  id?: number;
  timestamp?: number;
}

export interface WsClientSubscribeMessage {
  type: 'subscribe';
  eventTypes?: DashboardEventType[];
  jobId?: string;
  sinceId?: number;
}

// ── REST API types ───────────────────────────────────────────────────

export interface AgentStatusInfo {
  id: AgentId;
  status: AgentStatus;
  model?: string;
  currentActivity?: string;
  lastActivity?: number;
}

export interface QueueInfo {
  chatId: number;
  depth: number;
  isProcessing: boolean;
  lastMessage?: string;
  updatedAt: number;
}

export interface DashboardTask {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'archived';
  assignedAgent?: AgentId;
  priority: 'low' | 'medium' | 'high' | 'critical';
  linkedSession?: string;
  createdAt: number;
  updatedAt: number;
}

export type DashboardJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'timeout';

export type DashboardJobLane = 'main' | 'subagent' | 'review' | 'maintenance';

export interface DashboardJobInfo {
  jobId: string;
  name: string;
  lane: DashboardJobLane;
  state: DashboardJobState;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  parentJobId?: string;
  rootJobId: string;
  progress?: string;
  resultSummary?: string;
  error?: string;
  origin?: {
    channelId?: string;
    threadId?: string;
    userId?: string;
  };
  artifacts?: string[];
  returnRoute?: {
    channelId?: string;
    threadId?: string;
    userId?: string;
    mode?: string;
  };
}

export interface DashboardJobResultPayload {
  jobId: string;
  state: DashboardJobState;
  resultSummary?: string | null;
  artifacts: string[];
  error?: string | null;
  endedAt?: number | null;
  finalText?: string | null;
  changedFiles?: string[];
  childSummaries?: string[];
  delivery?: {
    mode?: string;
    delivered: boolean;
    channelId?: string;
    threadId?: string;
    userId?: string;
  } | null;
}

export interface DashboardJobLogPage {
  jobId: string;
  state: DashboardJobState;
  total: number;
  cursor: number;
  nextCursor: number;
  hasMore: boolean;
  logs: Array<{ at: number; level: 'info' | 'warn' | 'error'; message: string }>;
}

export interface DashboardJobEventPage {
  jobId: string;
  state: DashboardJobState;
  total: number;
  cursor: number;
  nextCursor: number;
  hasMore: boolean;
  events: JobEvent[];
}

export interface DashboardObjectiveEventPage {
  objective: ObjectiveRecord;
  total: number;
  cursor: number;
  nextCursor: number;
  hasMore: boolean;
  events: ObjectiveEvent[];
}

export interface DashboardJobMetrics {
  totalQueued: number;
  totalStarted: number;
  totalEnded: number;
  totalSucceeded: number;
  totalFailed: number;
  totalCanceled: number;
  totalTimeout: number;
  queueDepth: number;
  running: boolean;
  peakQueueDepth: number;
  waitP95Ms: number;
  runP95Ms: number;
}

export interface FleetSummary {
  generatedAt: number;
  agents: AgentStatusInfo[];
  queues: QueueInfo[];
  jobs: {
    metrics: DashboardJobMetrics;
    active: DashboardJobInfo[];
    recent: DashboardJobInfo[];
  };
  config: {
    botName: string;
    botMode: string;
    dashboardPort: number;
    dangerousMode: boolean;
  };
}
