import assert from 'node:assert/strict';
import test from 'node:test';

test('buildStatusMessage shows legacy fallback project source while keeping scoped runtime fields', async () => {
  const { buildStatusMessage } = await import('./status-view.js');

  const content = buildStatusMessage({
    projectPath: '/tmp/legacy-project',
    projectSourceLabel: 'legacy fallback',
    provider: 'claude',
    model: 'scoped-model',
    processing: true,
    dangerous: false,
    recentJobs: {
      running: 1,
      queued: 2,
      total: 3,
      lanes: 'scoped-lane-1',
    },
    scopedChatId: 12345,
    legacyChatId: 67890,
    usage: {
      inputTokens: 400,
      outputTokens: 100,
      contextWindow: 2000,
      totalCostUsd: 0.1256,
      numTurns: 7,
    },
  });

  assert.match(content, /\*\*Project:\*\* `\/tmp\/legacy-project`/);
  assert.match(content, /\*\*Project Source:\*\* legacy fallback/);
  assert.match(content, /\*\*Model:\*\* scoped-model/);
  assert.match(content, /\*\*Processing:\*\* Yes/);
  assert.match(content, /\*\*Context:\*\* 500 \/ 2,000 tokens \(25%\)/);
  assert.doesNotMatch(content, /\*\*Session ID:\*\*/);
});

test('buildStatusMessage shows explicit none source when no project is bound', async () => {
  const { buildStatusMessage } = await import('./status-view.js');

  const content = buildStatusMessage({
    projectSourceLabel: 'none',
    provider: 'claude',
    model: 'scoped-model',
    processing: false,
    dangerous: false,
    recentJobs: {
      running: 0,
      queued: 0,
      total: 0,
      lanes: '',
    },
    scopedChatId: 12345,
    legacyChatId: 67890,
  });

  assert.match(content, /No active session\. Use `\/project <path>` to start\./);
  assert.match(content, /\*\*Project Source:\*\* none/);
});
