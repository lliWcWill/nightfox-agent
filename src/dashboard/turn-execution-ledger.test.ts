import assert from 'node:assert/strict';
import test from 'node:test';
import { eventBus } from './event-bus.js';
import { TurnExecutionLedger } from './turn-execution-ledger.js';

test('turn ledger records tool execution and delegated jobs from runtime events', () => {
  const ledger = new TurnExecutionLedger(process.cwd());
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
  }
});

test('turn ledger records reply-only turns from runtime events', () => {
  const ledger = new TurnExecutionLedger(process.cwd());
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
  }
});
