import { getActiveContextTokens, getContextUsagePercent } from '../../providers/usage-math.js';

export interface StatusUsage {
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  totalCostUsd: number;
  numTurns: number;
}

export interface StatusRecentJobs {
  running: number;
  queued: number;
  total: number;
  lanes: string;
}

export interface BuildStatusMessageInput {
  projectPath?: string;
  projectSourceLabel: 'scoped' | 'legacy fallback' | 'none';
  provider: string;
  model: string;
  processing: boolean;
  dangerous: boolean;
  recentJobs: StatusRecentJobs;
  scopedClaudeSessionId?: string;
  scopedChatId: number;
  legacyChatId: number;
  usage?: StatusUsage;
}

export function buildStatusMessage(input: BuildStatusMessageInput): string {
  const lines: string[] = ['**Bot Status**\n'];

  if (input.projectPath) {
    lines.push(`**Project:** \`${input.projectPath}\``);
    lines.push(`**Project Source:** ${input.projectSourceLabel}`);
    lines.push(`**Provider:** ${input.provider}`);
    lines.push(`**Model:** ${input.model}`);
    lines.push(`**Processing:** ${input.processing ? 'Yes' : 'No'}`);
    lines.push(`**Dangerous Mode:** ${input.dangerous ? 'ENABLED' : 'Disabled'}`);
    lines.push(`**Jobs (recent):** running ${input.recentJobs.running} · queued ${input.recentJobs.queued} · total ${input.recentJobs.total}`);
    if (input.recentJobs.lanes) {
      lines.push(`**Job Lanes:** ${input.recentJobs.lanes}`);
    }

    lines.push(`**Lane ID:** \`${input.scopedChatId}\``);
    if (input.scopedChatId !== input.legacyChatId) {
      lines.push(`**Legacy Lane ID:** \`${input.legacyChatId}\``);
    }
    if (input.scopedClaudeSessionId) {
      lines.push(`**Session ID:** \`${input.scopedClaudeSessionId}\``);
    }

    if (input.usage) {
      const activeTokens = getActiveContextTokens(input.usage);
      const pct = getContextUsagePercent(input.usage);
      lines.push(`\n**Context:** ${activeTokens.toLocaleString()} / ${input.usage.contextWindow.toLocaleString()} tokens (${pct}%)`);
      lines.push(`**Cost:** $${input.usage.totalCostUsd.toFixed(4)}`);
      lines.push(`**Turns:** ${input.usage.numTurns}`);
    }
  } else {
    lines.push('No active session. Use `/project <path>` to start.');
    lines.push(`**Project Source:** ${input.projectSourceLabel}`);
    lines.push(`**Lane ID:** \`${input.scopedChatId}\``);
    if (input.scopedChatId !== input.legacyChatId) {
      lines.push(`**Legacy Lane ID:** \`${input.legacyChatId}\``);
    }
  }

  return lines.join('\n');
}
