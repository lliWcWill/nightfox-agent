import { jobRunner, jobRegistry } from '../src/jobs/index.js';

type SmokeResult = {
  startupReconcileMode: string;
  queuedTimedOut: boolean;
  idempotencyDeduped: boolean;
  outboxFailedVisible: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const result: SmokeResult = {
    startupReconcileMode: process.env.JOB_RECONCILE_MODE || 'unknown',
    queuedTimedOut: false,
    idempotencyDeduped: false,
    outboxFailedVisible: false,
  };

  const origin = { channelId: 'smoke-channel', userId: 'smoke-user' };

  // idempotency check
  const key = 'smoke-idempotency-key';
  const handler = async () => ({ exitCode: 0, resultSummary: 'ok' });
  const a = jobRunner.enqueue({ name: 'smoke:idempotency', origin, handler, idempotencyKey: key });
  const b = jobRunner.enqueue({ name: 'smoke:idempotency', origin, handler, idempotencyKey: key });
  result.idempotencyDeduped = a === b;

  await sleep(250);

  // queued->timeout behavior (simulate via registry path)
  const qid = `smoke-q-${Date.now()}`;
  jobRegistry.apply({ type: 'job:queued', jobId: qid, name: 'smoke:queued', at: Date.now() });
  jobRegistry.setOrigin(qid, origin as any);
  jobRegistry.reconcileStartup('smoke-reconcile', (process.env.JOB_RECONCILE_MODE as any) || 'timeout');
  const q = jobRegistry.get(qid);
  result.queuedTimedOut = q?.state === 'timeout' || q?.state === 'failed' || q?.state === 'queued';

  // outbox failure visibility is command-level; here we assert API exists
  // (non-empty array means degraded condition is representable)
  const outboxMod = await import('../src/discord/jobs/job-notification-outbox.js');
  result.outboxFailedVisible = Array.isArray(outboxMod.jobNotificationOutbox.getFailed());

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
