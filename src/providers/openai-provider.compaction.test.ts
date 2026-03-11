import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenAIProvider } from './openai-provider.js';

test('buildCompactedHistory returns a non-destructive compacted copy', () => {
  const provider = new OpenAIProvider();
  const history = [
    { role: 'user' as const, content: 'A'.repeat(800) },
    { role: 'assistant' as const, content: 'B'.repeat(800) },
    { role: 'user' as const, content: 'C'.repeat(800) },
    { role: 'assistant' as const, content: 'D'.repeat(800) },
    { role: 'user' as const, content: 'E'.repeat(800) },
    { role: 'assistant' as const, content: 'F'.repeat(800) },
    { role: 'user' as const, content: 'G'.repeat(800) },
    { role: 'assistant' as const, content: 'H'.repeat(800) },
  ];
  const originalSnapshot = structuredClone(history);

  const result = (provider as any).buildCompactedHistory(history, 2000, true);

  assert.ok(result);
  assert.deepEqual(history, originalSnapshot);
  assert.notDeepEqual(result.history, history);
  assert.equal(result.compaction.trigger, 'auto');
  assert.ok(result.compaction.preTokens > 0);
  assert.match(result.history[0].content, /SYSTEM NOTE: Conversation summary for continued context:/);
});

test('maybeCompactHistory returns a compacted copy without mutating original history', () => {
  const provider = new OpenAIProvider();
  const history = [
    { role: 'user' as const, content: 'A'.repeat(800) },
    { role: 'assistant' as const, content: 'B'.repeat(800) },
    { role: 'user' as const, content: 'C'.repeat(800) },
    { role: 'assistant' as const, content: 'D'.repeat(800) },
    { role: 'user' as const, content: 'E'.repeat(800) },
    { role: 'assistant' as const, content: 'F'.repeat(800) },
    { role: 'user' as const, content: 'G'.repeat(800) },
    { role: 'assistant' as const, content: 'H'.repeat(800) },
  ];
  const originalSnapshot = structuredClone(history);

  const result = (provider as any).maybeCompactHistory(history, 2000);

  assert.ok(result);
  assert.deepEqual(history, originalSnapshot);
  assert.notDeepEqual(result.history, history);
});

test('buildCompactedHistory skips force compaction for short low-usage histories', () => {
  const provider = new OpenAIProvider();
  const history = [
    { role: 'user' as const, content: 'short 1' },
    { role: 'assistant' as const, content: 'short 2' },
    { role: 'user' as const, content: 'short 3' },
    { role: 'assistant' as const, content: 'short 4' },
    { role: 'user' as const, content: 'short 5' },
    { role: 'assistant' as const, content: 'short 6' },
  ];

  const result = (provider as any).buildCompactedHistory(history, 2000, true);
  assert.equal(result, undefined);
});

test('buildCompactedHistory honors the configured excerpt limit', () => {
  const provider = new OpenAIProvider({ compactionExcerptLength: 80 });
  const history = [
    { role: 'user' as const, content: 'A'.repeat(400) },
    { role: 'assistant' as const, content: 'B'.repeat(400) },
    { role: 'user' as const, content: 'C'.repeat(400) },
    { role: 'assistant' as const, content: 'D'.repeat(400) },
    { role: 'user' as const, content: 'E'.repeat(400) },
    { role: 'assistant' as const, content: 'F'.repeat(400) },
    { role: 'user' as const, content: 'G'.repeat(400) },
    { role: 'assistant' as const, content: 'H'.repeat(400) },
  ];

  const result = (provider as any).buildCompactedHistory(history, 2000, true);

  assert.ok(result);
  assert.match(result.history[0].content, new RegExp(`1\\. user: A{80}…`));
  assert.doesNotMatch(result.history[0].content, new RegExp(`1\\. user: A{81}`));
});
