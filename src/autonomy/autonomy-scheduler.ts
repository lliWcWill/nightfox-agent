import type { JobSnapshot } from '../jobs/core/job-types.js';
import { objectiveStore } from './index.js';

class AutonomyScheduler {
  wakeFromJobEnd(snapshot: JobSnapshot) {
    const objective = objectiveStore.findByChildJobId(snapshot.jobId);
    if (!objective) return null;
    const nextState = snapshot.state === 'succeeded' ? 'waiting' : snapshot.state === 'canceled' ? 'canceled' : 'failed';
    return objectiveStore.update(objective.objectiveId, {
      state: nextState,
      nextActions: snapshot.state === 'succeeded'
        ? ['Summarize delegated completion back to the user.']
        : ['Report delegated failure back to the user.'],
    });
  }
}

export const autonomyScheduler = new AutonomyScheduler();
