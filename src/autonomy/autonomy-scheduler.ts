import type { JobSnapshot } from '../jobs/core/job-types.js';
import { objectiveEventStore, objectiveRunnerManager, objectiveStore } from './index.js';

class AutonomyScheduler {
  wakeFromJobEnd(snapshot: JobSnapshot) {
    const objective = objectiveStore.findByChildJobId(snapshot.jobId);
    if (!objective) return null;
    if (objective.state === 'canceled') {
      objectiveEventStore.append({
        objectiveId: objective.objectiveId,
        type: 'objective:delivery-skipped',
        at: Date.now(),
        childJobId: snapshot.jobId,
        reason: 'objective_canceled',
      });
      return objective;
    }
    objectiveRunnerManager.handleChildCompletion(snapshot);
    return objective;
  }
}

export const autonomyScheduler = new AutonomyScheduler();
