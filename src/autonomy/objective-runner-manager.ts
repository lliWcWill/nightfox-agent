import type { JobSnapshot } from '../jobs/core/job-types.js';
import { objectiveEventStore, objectiveStore } from './index.js';

class ObjectiveActor {
  private running = false;
  private pending: JobSnapshot[] = [];

  constructor(private readonly objectiveId: string) {}

  enqueueCompletion(snapshot: JobSnapshot) {
    this.pending.push(snapshot);
    void this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const snapshot = this.pending.shift();
        if (!snapshot) continue;
        const objective = objectiveStore.get(this.objectiveId);
        if (!objective) continue;
        if (objective.state === 'completed' || objective.state === 'failed' || objective.state === 'canceled') {
          objectiveEventStore.append({
            objectiveId: this.objectiveId,
            type: 'objective:delivery-skipped',
            at: Date.now(),
            childJobId: snapshot.jobId,
            reason: `objective_terminal:${objective.state}`,
          });
          continue;
        }

        const succeeded = snapshot.state === 'succeeded';
        const nextActions = succeeded
          ? ['Summarize delegated completion back to the user.']
          : snapshot.state === 'canceled'
            ? ['Do not send completion update; objective was canceled.']
            : ['Report delegated failure back to the user.'];
        const nextState = succeeded ? 'waiting' : snapshot.state === 'canceled' ? 'canceled' : 'failed';
        const updated = objectiveStore.transition(this.objectiveId, nextState, {
          nextActions,
          lastChildJobId: snapshot.jobId,
          lastChildState: snapshot.state,
          lastResultSummary: snapshot.resultSummary,
        });
        if (!updated) continue;

        objectiveEventStore.append({
          objectiveId: this.objectiveId,
          type: 'objective:child-completed',
          at: Date.now(),
          state: updated.state,
          childJobId: snapshot.jobId,
          summary: snapshot.resultSummary,
        });

        if (updated.state === 'waiting') {
          objectiveEventStore.append({
            objectiveId: this.objectiveId,
            type: 'objective:delivery-ready',
            at: Date.now(),
            childJobId: snapshot.jobId,
            summary: snapshot.resultSummary,
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export class ObjectiveRunnerManager {
  private readonly actors = new Map<string, ObjectiveActor>();

  private actorFor(objectiveId: string) {
    let actor = this.actors.get(objectiveId);
    if (!actor) {
      actor = new ObjectiveActor(objectiveId);
      this.actors.set(objectiveId, actor);
    }
    return actor;
  }

  handleChildCompletion(snapshot: JobSnapshot) {
    const objective = objectiveStore.findByChildJobId(snapshot.jobId);
    if (!objective) return null;
    this.actorFor(objective.objectiveId).enqueueCompletion(snapshot);
    return objective.objectiveId;
  }
}

export const objectiveRunnerManager = new ObjectiveRunnerManager();
