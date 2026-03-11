import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { eventBus } from './event-bus.js';
import { TurnExecutionLedger } from './turn-execution-ledger.js';

function makeTempRepoRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('turn ledger records tool execution and delegated jobs from runtime events', () => {
  const repoRoot = makeTempRepoRoot('nightfox-turn-ledger-');
  const ledger = new TurnExecutionLedger(repoRoot);
  ledger.start();
  try {
    eventBus.emit('agent:start', { chatId: 4242, model: 'gpt', prompt: 'do work', timestamp: 1000 });
    eventBus.emit('agent:tool_start', { chatId: 4242, toolName: 'shell', callId: 'c1', timestamp: 1010 });
    eventBus.emit('agent:tool_end', { chatId: 4242, toolName: 'shell', callId: 'c1', status: 'completed', timestamp: 1020 });
    eventBus.emit('job:queued', { type: 'job:queued', jobId: 'job-1', name: 'delegated', at: 1030, returnRoute: { platform: 'discord', channelId: '1', userId: 'u', parentChatId: 4242, mode: 'origin', capturedAt: 1030 } });
    eventBus.emit('agent:complete', { chatId: 4242, text: 'done', toolsUsed: ['shell'], durationMs: 50, timestamp: 1040 });

    const latest = ledger.getLatest(4242);
    assert(latest);
    assert.equal(latest.disposition, 'respond_and_delegate');
    assert.equal(latest.toolCalls.length, 1);
    assert.equal(latest.delegatedJobIds[0], 'job-1');
  } finally {
    ledger.stop();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('turn ledger records reply-only turns from runtime events', () => {
  const repoRoot = makeTempRepoRoot('nightfox-turn-ledger-');
  const ledger = new TurnExecutionLedger(repoRoot);
  ledger.start();
  try {
    eventBus.emit('agent:start', { chatId: 5252, model: 'gpt', prompt: 'just answer', timestamp: 2000 });
    eventBus.emit('agent:complete', { chatId: 5252, text: 'done', toolsUsed: [], durationMs: 25, timestamp: 2025 });

    const latest = ledger.getLatest(5252);
    assert(latest);
    assert.equal(latest.disposition, 'respond_only');
    assert.equal(latest.toolCalls.length, 0);
    assert.equal(latest.delegatedJobIds.length, 0);
  } finally {
    ledger.stop();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('turn ledger does not infer waiting_on_user from the original user prompt', () => {
  const repoRoot = makeTempRepoRoot('nightfox-turn-ledger-');
  const ledger = new TurnExecutionLedger(repoRoot);
  ledger.start();
  try {
    eventBus.emit('agent:start', {
      chatId: 6262,
      model: 'gpt',
      prompt: 'I need your approval on this plan',
      timestamp: 3000,
    });
    eventBus.emit('agent:tool_start', { chatId: 6262, toolName: 'shell', callId: 'c2', timestamp: 3010 });
    eventBus.emit('agent:tool_end', { chatId: 6262, toolName: 'shell', callId: 'c2', status: 'completed', timestamp: 3020 });
    eventBus.emit('agent:complete', {
      chatId: 6262,
      text: 'Implemented the fix and queued the follow-up task.',
      toolsUsed: ['shell'],
      durationMs: 30,
      timestamp: 3030,
    });

    const latest = ledger.getLatest(6262);
    assert(latest);
    assert.equal(latest.waitingForUser, false);
    assert.equal(latest.disposition, 'respond_and_execute');
  } finally {
    ledger.stop();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('turn ledger marks waiting_on_user from assistant reply text', () => {
  const repoRoot = makeTempRepoRoot('nightfox-turn-ledger-');
  const ledger = new TurnExecutionLedger(repoRoot);
  ledger.start();
  try {
    eventBus.emit('agent:start', {
      chatId: 6363,
      model: 'gpt',
      prompt: 'continue',
      timestamp: 4000,
    });
    eventBus.emit('agent:complete', {
      chatId: 6363,
      text: 'I need your approval before I can continue.',
      toolsUsed: [],
      durationMs: 20,
      timestamp: 4010,
    });

    const latest = ledger.getLatest(6363);
    assert(latest);
    assert.equal(latest.waitingForUser, true);
    assert.equal(latest.disposition, 'waiting_on_user');
  } finally {
    ledger.stop();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('turn ledger warns and clears cached state on invalid persisted JSON', () => {
  const repoRoot = makeTempRepoRoot('nightfox-turn-ledger-invalid-');
  const persistDir = path.join(repoRoot, '.nightfox', 'dashboard');
  const persistPath = path.join(persistDir, 'turn-execution.json');
  fs.mkdirSync(persistDir, { recursive: true });
  fs.writeFileSync(persistPath, '{invalid json');

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const ledger = new TurnExecutionLedger(repoRoot);
    assert.equal(ledger.getLatest(9999), undefined);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /Failed to load persisted state/);
    assert.match(String(warnings[0][0]), /turn-execution\.json/);
  } finally {
    console.warn = originalWarn;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('turn ledger swallows persist write failures and keeps state in memory', () => {
  const repoRoot = makeTempRepoRoot('nightfox-turn-ledger-persist-');
  const ledger = new TurnExecutionLedger(repoRoot);
  const originalWriteFileSync = fs.writeFileSync;
  const errors: unknown[][] = [];
  const originalError = console.error;

  fs.writeFileSync = (() => {
    throw new Error('disk full');
  }) as typeof fs.writeFileSync;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };

  ledger.start();
  try {
    assert.doesNotThrow(() => {
      eventBus.emit('agent:start', { chatId: 6464, model: 'gpt', prompt: 'do work', timestamp: 5000 });
      eventBus.emit('agent:complete', {
        chatId: 6464,
        text: 'done',
        toolsUsed: [],
        durationMs: 5,
        timestamp: 5005,
      });
    });

      const latest = ledger.getLatest(6464);
      assert(latest);
      assert.equal(latest.disposition, 'respond_only');
      assert.ok(errors.length >= 1);
      assert.match(String(errors[0][0]), /Failed to persist turn execution state/);
  } finally {
    ledger.stop();
    fs.writeFileSync = originalWriteFileSync;
    console.error = originalError;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
