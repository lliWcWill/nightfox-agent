import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getActiveContextTokens,
  getContextUsagePercent,
  getRemainingContextPercent,
  getTotalUsageTokens,
} from './usage-math.js';

test('usage math treats active context as input + output only', () => {
  const usage = {
    inputTokens: 400,
    outputTokens: 100,
    cacheReadTokens: 250,
    cacheWriteTokens: 50,
    contextWindow: 2000,
  };

  assert.equal(getActiveContextTokens(usage), 500);
  assert.equal(getTotalUsageTokens(usage), 800);
  assert.equal(getContextUsagePercent(usage), 25);
  assert.equal(getRemainingContextPercent(usage), 75);
});

test('usage math clamps zero-window percentages safely', () => {
  const usage = {
    inputTokens: 400,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextWindow: 0,
  };

  assert.equal(getContextUsagePercent(usage), 0);
  assert.equal(getRemainingContextPercent(usage), 0);
});
