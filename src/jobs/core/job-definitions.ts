import type {
  JobHandler,
  JobHandoff,
  JobLane,
  JobResumeSpec,
  AgentDeepLoopResumeSpec,
  CodeRabbitReviewResumeSpec,
  MaintenanceResumeSpec,
} from './job-types.js';
import { agentDeepLoopJob, type AgentDeepLoopPayload } from '../workers/agent-deep-loop.js';
import { coderabbitReview, type CodeRabbitPayload } from '../workers/coderabbit-review.js';
import { fullSelfRefreshJob, restartDiscordServiceJob, selfCheckJob, selfUpdateJob } from '../workers/devops-maintenance.js';
import { npmBuildV2 } from '../workers/npm-build-v2.js';

export type PreparedBackgroundJob = {
  name: string;
  lane: JobLane;
  handler: JobHandler;
  timeoutMs?: number;
  stallTimeoutMs?: number;
  resumeSpec: JobResumeSpec;
  handoff?: JobHandoff;
};

function createCodeRabbitReviewHandler(payload: CodeRabbitPayload, jobName: string): JobHandler {
  return async (ctx) =>
    coderabbitReview({
      id: ctx.jobId,
      name: jobName,
      payload,
      state: 'running',
      createdAt: Date.now(),
    });
}

function createMaintenanceHandler(payload: MaintenanceResumeSpec['payload']): JobHandler | null {
  switch (payload.job) {
    case 'build':
      return payload.repoPath ? npmBuildV2({ repoPath: payload.repoPath }) : null;
    case 'self-check':
      return payload.repoPath ? selfCheckJob(payload.repoPath) : null;
    case 'self-update':
      return payload.repoPath ? selfUpdateJob(payload.repoPath) : null;
    case 'restart-discord-service':
      return restartDiscordServiceJob();
    case 'full-self-refresh':
      return payload.repoPath ? fullSelfRefreshJob(payload.repoPath) : null;
    default:
      return null;
  }
}

export function canResumeJobLane(lane: JobLane): boolean {
  return lane === 'subagent' || lane === 'review' || lane === 'maintenance';
}

export function prepareAgentDeepLoopJob(params: {
  name: string;
  lane: Extract<JobLane, 'subagent' | 'review'>;
  payload: AgentDeepLoopPayload & { parentChatId: number; childChatId: number };
  timeoutMs: number;
  handoff?: JobHandoff;
}): PreparedBackgroundJob {
  const resumeSpec: AgentDeepLoopResumeSpec = {
    kind: 'agent-deep-loop',
    payload: {
      userId: params.payload.userId,
      parentChatId: params.payload.parentChatId,
      childChatId: params.payload.childChatId,
      task: params.payload.task,
      model: params.payload.model,
      maxIterations: params.payload.maxIterations,
    },
  };
  return {
    name: params.name,
    lane: params.lane,
    handler: agentDeepLoopJob(params.payload),
    timeoutMs: params.timeoutMs,
    resumeSpec,
    handoff: params.handoff,
  };
}

export function prepareCodeRabbitReviewJob(params: {
  name?: string;
  payload: CodeRabbitPayload;
  timeoutMs: number;
  handoff?: JobHandoff;
}): PreparedBackgroundJob {
  const name = params.name ?? 'coderabbit-review';
  const resumeSpec: CodeRabbitReviewResumeSpec = {
    kind: 'coderabbit-review',
    payload: {
      repoPath: params.payload.repoPath,
      baseRef: params.payload.baseRef,
      target: params.payload.target,
      promptOnly: params.payload.promptOnly,
    },
  };
  return {
    name,
    lane: 'review',
    handler: createCodeRabbitReviewHandler(params.payload, name),
    timeoutMs: params.timeoutMs,
    resumeSpec,
    handoff: params.handoff,
  };
}

export function prepareMaintenanceJob(params: {
  job: MaintenanceResumeSpec['payload']['job'];
  repoPath?: string;
  timeoutMs: number;
  handoff?: JobHandoff;
  name?: string;
}): PreparedBackgroundJob {
  const payload: MaintenanceResumeSpec['payload'] = {
    job: params.job,
    repoPath: params.repoPath,
  };
  const handler = createMaintenanceHandler(payload);
  if (!handler) {
    throw new Error(`Unable to build maintenance handler for ${params.job}`);
  }
  return {
    name: params.name ?? `devops:${params.job}`,
    lane: 'maintenance',
    handler,
    timeoutMs: params.timeoutMs,
    resumeSpec: {
      kind: 'maintenance',
      payload,
    },
    handoff: params.handoff,
  };
}

export function createJobHandlerFromResumeSpec(name: string, spec: JobResumeSpec): JobHandler | null {
  switch (spec.kind) {
    case 'agent-deep-loop':
      return agentDeepLoopJob(spec.payload);
    case 'coderabbit-review':
      return createCodeRabbitReviewHandler(spec.payload, name);
    case 'maintenance':
      return createMaintenanceHandler(spec.payload);
    default:
      return null;
  }
}
