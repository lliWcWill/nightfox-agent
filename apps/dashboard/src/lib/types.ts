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
  input?: Record<string, unknown>;
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
  priority?: "low" | "medium" | "high";
  labels?: string[];
}
