import { objectiveStore } from '../autonomy/index.js';
import { cancelRequest, clearQueue, isProcessing } from '../claude/request-queue.js';
import { jobRunner } from '../jobs/index.js';
import type { JobSnapshot } from '../jobs/core/job-types.js';

export type CancelChatParams = {
  chatIds: number[];
  origin?: {
    channelId: string;
    threadId?: string;
    userId: string;
  };
};

export type CancelChatResult = {
  cancelledRequests: boolean;
  clearedQueuedRequests: number;
  cancelledJobs: string[];
  cancelledObjectives: string[];
  hadProcessing: boolean;
};

function matchesOrigin(job: JobSnapshot, origin: NonNullable<CancelChatParams['origin']>): boolean {
  if (!job.origin) return false;
  return job.origin.channelId === origin.channelId
    && job.origin.userId === origin.userId
    && (job.origin.threadId ?? undefined) === (origin.threadId ?? undefined);
}

function matchesChat(job: JobSnapshot, chatIds: number[]): boolean {
  const parentChatId = job.handoff?.parentChatId ?? job.returnRoute?.parentChatId;
  return typeof parentChatId === 'number' && chatIds.includes(parentChatId);
}

export async function cancelChatOperations(params: CancelChatParams): Promise<CancelChatResult> {
  const uniqueChatIds = Array.from(new Set(params.chatIds));
  const hadProcessing = uniqueChatIds.some((chatId) => isProcessing(chatId));
  let cancelledRequests = false;
  let clearedQueuedRequests = 0;

  for (const chatId of uniqueChatIds) {
    cancelledRequests = (await cancelRequest(chatId)) || cancelledRequests;
    clearedQueuedRequests += clearQueue(chatId);
  }

  const snapshots = jobRunner.listAll();
  const targetJobIds = snapshots
    .filter((job) => (job.state === 'queued' || job.state === 'running'))
    .filter((job) => {
      if (params.origin && matchesOrigin(job, params.origin)) return true;
      return matchesChat(job, uniqueChatIds);
    })
    .map((job) => job.jobId);

  const cancelledJobs = targetJobIds.filter((jobId) => jobRunner.cancel(jobId));

  const cancelledObjectives = objectiveStore.list()
    .filter((objective) => objective.state === 'active' || objective.state === 'waiting')
    .filter((objective) => uniqueChatIds.includes(objective.chatId))
    .filter((objective) => {
      if (!params.origin) return true;
      return objective.channelId === params.origin.channelId
        && objective.userId === params.origin.userId
        && (objective.threadId ?? undefined) === (params.origin.threadId ?? undefined);
    })
    .map((objective) => {
      objectiveStore.update(objective.objectiveId, {
        state: 'canceled',
        nextActions: [],
        wakeAt: undefined,
      });
      return objective.objectiveId;
    });

  return {
    cancelledRequests,
    clearedQueuedRequests,
    cancelledJobs,
    cancelledObjectives,
    hadProcessing,
  };
}

export async function cancelObjectiveById(objectiveId: string) {
  const objective = objectiveStore.get(objectiveId);
  if (!objective) return null;

  const cancelledJobs = objective.childJobIds.filter((jobId) => jobRunner.cancel(jobId));
  if (objective.parentJobId) {
    jobRunner.cancel(objective.parentJobId);
  }

  const updated = objectiveStore.update(objectiveId, {
    state: 'canceled',
    nextActions: [],
    wakeAt: undefined,
  });

  return {
    objective: updated,
    cancelledJobs,
  };
}
