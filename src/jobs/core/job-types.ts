export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'timeout';

export type JobLogLevel = 'info' | 'warn' | 'error';

export type JobLane = 'main' | 'subagent' | 'review' | 'maintenance';

export type JobPlatform = 'discord' | 'telegram';

export type JobReturnRoute = {
  platform: JobPlatform;
  channelId: string;
  threadId?: string;
  guildId?: string;
  userId: string;
  parentChatId?: number;
  mode: 'origin' | 'parent-session';
  capturedAt: number;
};

export type AgentDeepLoopResumeSpec = {
  kind: 'agent-deep-loop';
  payload: {
    userId?: string;
    parentChatId: number;
    childChatId: number;
    task: string;
    model?: string;
    maxIterations?: number;
  };
};

export type CodeRabbitReviewResumeSpec = {
  kind: 'coderabbit-review';
  payload: {
    repoPath: string;
    baseRef: string;
    target: 'committed' | 'uncommitted';
    promptOnly: boolean;
  };
};

export type MaintenanceResumeSpec = {
  kind: 'maintenance';
  payload: {
    job: 'build' | 'self-check' | 'self-update' | 'restart-discord-service' | 'full-self-refresh';
    repoPath?: string;
  };
};

export type JobResumeSpec =
  | AgentDeepLoopResumeSpec
  | CodeRabbitReviewResumeSpec
  | MaintenanceResumeSpec;

export type JobHandoff = {
  mode: 'parent-session';
  parentChatId: number;
  platform?: JobPlatform;
};

export type JobEvent =
  | {
      type: 'job:queued';
      jobId: string;
      name: string;
      at: number;
      lane?: JobLane;
      parentJobId?: string;
      rootJobId?: string;
      timeoutMs?: number;
      stallTimeoutMs?: number;
      resumeSpec?: JobResumeSpec;
      handoff?: JobHandoff;
      returnRoute?: JobReturnRoute;
    }
  | { type: 'job:origin'; jobId: string; origin: JobOrigin; at: number }
  | { type: 'job:idempotency'; jobId: string; key: string; at: number }
  | { type: 'job:start'; jobId: string; at: number; lane?: JobLane }
  | { type: 'job:progress'; jobId: string; message: string; at: number }
  | { type: 'job:log'; jobId: string; level: JobLogLevel; message: string; at: number }
  | { type: 'job:result'; jobId: string; summary?: string; artifacts?: string[]; at: number }
  | { type: 'job:end'; jobId: string; state: Exclude<JobState, 'queued' | 'running'>; exitCode?: number | null; at: number };

export type JobOrigin = {
  guildId?: string;
  channelId: string;
  threadId?: string;
  userId: string;
  // where the bot should edit/update
  statusMessageId?: string;
};

export type JobSnapshot = {
  jobId: string;
  name: string;
  createdAt: number;
  lane: JobLane;
  parentJobId?: string;
  rootJobId: string;
  childJobIds: string[];
  idempotencyKey?: string;
  timeoutMs?: number;
  stallTimeoutMs?: number;
  resumeSpec?: JobResumeSpec;
  handoff?: JobHandoff;
  startedAt?: number;
  endedAt?: number;
  state: JobState;
  origin: JobOrigin;
  returnRoute?: JobReturnRoute;
  progress?: string;
  exitCode?: number | null;
  error?: string;
  logs: Array<{ at: number; level: JobLogLevel; message: string }>;
  events: JobEvent[];
  resultSummary?: string;
  artifacts?: string[];
};

export type JobRunContext = {
  jobId: string;
  lane: JobLane;
  parentJobId?: string;
  rootJobId: string;
  origin: JobOrigin;
  returnRoute?: JobReturnRoute;
  signal: AbortSignal;
  progress: (message: string) => void;
  log: (level: JobLogLevel, message: string) => void;
};

export type JobHandler = (ctx: JobRunContext) => Promise<{
  exitCode?: number | null;
  resultSummary?: string;
  artifacts?: string[];
} | void>;
