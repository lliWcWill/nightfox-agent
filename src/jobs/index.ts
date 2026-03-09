import { config } from '../config.js';
import { eventBus } from '../dashboard/event-bus.js';
import { JobManager } from './job-manager.js';
import { canResumeJobLane, createJobHandlerFromResumeSpec } from './core/job-definitions.js';
import { defaultJobRegistry } from './core/job-registry.js';
import { JobRunner } from './core/job-runner.js';

export const jobManager = new JobManager(1);

export const repoRoot = process.cwd();
export const jobRegistry = defaultJobRegistry(repoRoot);
const startupReason = 'Bot restarted; reconciling in-flight jobs';
jobRegistry.bootstrapFromDisk();
jobRegistry.reconcileStartup(startupReason, config.JOB_RECONCILE_MODE);

export const jobRunner = new JobRunner(jobRegistry, 1);
if (config.JOB_RECONCILE_MODE === 'resume-queued') {
  const recovery = jobRunner.rehydrateQueuedJobs({
    reason: startupReason,
    shouldResumeLane: canResumeJobLane,
    resolveHandler: (snapshot) =>
      snapshot.resumeSpec ? createJobHandlerFromResumeSpec(snapshot.name, snapshot.resumeSpec) : null,
  });
  if (recovery.resumed > 0 || recovery.finalized > 0) {
    console.log(
      `[Jobs] startup recovery resumed=${recovery.resumed} finalized=${recovery.finalized}`,
    );
  }
}
jobRunner.onEvent((ev) => {
  eventBus.emit(ev.type, ev as any);
});
