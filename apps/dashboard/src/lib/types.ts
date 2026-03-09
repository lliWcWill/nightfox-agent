// Mirror of nightfox/src/dashboard/types.ts for the frontend

export type AgentId = "claude" | "gemini" | "droid" | "groq";
export type AgentStatus = "ready" | "thinking" | "error" | "offline";

export interface AgentStatusInfo {
  id: AgentId;
  status: AgentStatus;
  model?: string;
  currentActivity?: string;
  lastActivity?: number;
}

export interface WsMessage {
  type: string;
  payload: Record<string, unknown>;
  id?: number;
  timestamp?: number;
}

export interface DashboardTask {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done" | "archived";
  assignedAgent?: AgentId;
  priority: "low" | "medium" | "high" | "critical";
  linkedSession?: string;
  createdAt: number;
  updatedAt: number;
}

export interface QueueInfo {
  chatId: number;
  depth: number;
  isProcessing: boolean;
  lastMessage?: string;
  updatedAt: number;
}

export type DashboardJobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "timeout";

export type DashboardJobLane = "main" | "subagent" | "review" | "maintenance";

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
  events: Array<Record<string, unknown>>;
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

export interface DashboardEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface ToolCallInfo {
  id: string;
  chatId: number | string;
  toolName: string;
  callId?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  status: "running" | "completed" | "error";
  startedAt: number;
  completedAt?: number;
}

// ── Kanban ──────────────────────────────────────────────────────────

export type KanbanColumn = "todo" | "in_progress" | "done" | "archived";

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  column: KanbanColumn;
  agent: AgentId;
  createdAt: number;
  updatedAt: number;
  priority?: "low" | "medium" | "high" | "critical";
  labels?: string[];
}
