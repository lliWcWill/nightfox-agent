import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JobRegistry } from './job-registry.js';
import { JobRunner } from './job-runner.js';

test('JobRunner persists queued returnRoute metadata and restores it onto queued jobs', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightfox-job-runner-'));
  const persistPath = path.join(repoRoot, 'jobs.json');
  const registry = new JobRegistry({ persistPath, ttlMs: 60_000, maxLogsPerJob: 100 });
  const runner = new JobRunner(registry);
  (runner as any).pump = async () => {};
  const returnRoute = {
    platform: 'discord' as const,
    channelId: 'channel-1',
    userId: 'user-1',
    parentChatId: 42,
    mode: 'origin' as const,
    capturedAt: 1234,
  };

  try {
    const jobId = runner.enqueue({
      name: 'test-job',
      origin: { channelId: 'channel-1', userId: 'user-1' },
      handler: async () => undefined,
      resumeSpec: {
        kind: 'maintenance',
        payload: { job: 'build', repoPath: '/tmp/project' },
      },
      returnRoute,
    });

    const snapshot = registry.get(jobId);
    assert(snapshot);
    assert.deepEqual(snapshot.returnRoute, returnRoute);

    const rebuilt = (runner as any).buildQueuedJobFromSnapshot(snapshot, async () => undefined);
    assert.deepEqual(rebuilt.returnRoute, returnRoute);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
