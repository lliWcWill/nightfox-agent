import type { AgentUsage } from './types.js';

type UsageLike = Pick<AgentUsage, 'inputTokens' | 'outputTokens' | 'contextWindow'> & Partial<Pick<AgentUsage, 'cacheReadTokens' | 'cacheWriteTokens'>>;

export function getActiveContextTokens(usage: UsageLike): number {
  return usage.inputTokens + usage.outputTokens;
}

export function getTotalUsageTokens(usage: UsageLike): number {
  return getActiveContextTokens(usage) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

export function getContextUsagePercent(usage: UsageLike): number {
  if (usage.contextWindow <= 0) return 0;
  return Math.round((getActiveContextTokens(usage) / usage.contextWindow) * 100);
}

export function getRemainingContextPercent(usage: UsageLike): number {
  if (usage.contextWindow <= 0) return 0;
  return Math.round(Math.max(0, Math.min(100, ((usage.contextWindow - getActiveContextTokens(usage)) / usage.contextWindow) * 100)));
}
