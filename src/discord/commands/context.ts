import { ChatInputCommandInteraction } from 'discord.js';
import { execFile } from 'child_process';
import { discordChatId } from '../id-mapper.js';
import { sessionManager } from '../../claude/session-manager.js';
import { getCachedUsage } from '../../claude/agent.js';
import { config } from '../../config.js';
import { getActiveContextTokens, getContextUsagePercent, getTotalUsageTokens } from '../../providers/usage-math.js';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function getProgressBar(pct: number): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round(clamped / 10);
  const empty = 10 - filled;
  const color = clamped >= 80 ? '🔴' : clamped >= 60 ? '🟡' : '🟢';
  return color + ' [' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

function parseContextOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'No context output received.';

  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let model = '';
  let tokensLine = '';
  const categories: Array<{ name: string; tokens: string; percent: string }> = [];
  let inCategories = false;

  for (const line of lines) {
    if (/^model:/i.test(line)) {
      model = line.replace(/^model:/i, '').trim();
      continue;
    }
    if (/^total.*tokens/i.test(line)) {
      tokensLine = line;
      inCategories = true;
      continue;
    }
    if (inCategories) {
      const match = line.match(/^(.+?)\s+([\d,]+)\s+\((\d+%)\)/);
      if (match) {
        categories.push({ name: match[1], tokens: match[2], percent: match[3] });
      }
    }
  }

  const parts: string[] = ['**Context Usage**\n'];
  if (model) parts.push(`**Model:** ${model}`);
  if (tokensLine) parts.push(`**${tokensLine}**`);
  if (categories.length > 0) {
    parts.push('');
    for (const cat of categories) {
      parts.push(`• ${cat.name}: ${cat.tokens} (${cat.percent})`);
    }
  }

  if (parts.length === 1) {
    return `**Context Output**\n\`\`\`\n${trimmed.slice(0, 1800)}\n\`\`\``;
  }

  return parts.join('\n');
}

async function runClaudeContext(sessionId: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      config.CLAUDE_EXECUTABLE_PATH,
      ['-p', '--resume', sessionId, '/context'],
      {
        cwd,
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = (stderr || error.message).trim();
          reject(new Error(message || 'Failed to run /context'));
          return;
        }
        resolve((stdout || stderr || '').trim());
      }
    );
  });
}

export async function handleContext(interaction: ChatInputCommandInteraction): Promise<void> {
  const chatId = discordChatId(interaction.user.id);

  const session = sessionManager.getSession(chatId);
  if (!session) {
    await interaction.reply({
      content: 'No active session. Use `/project <path>` or `/continue` first.',
      ephemeral: true,
    });
    return;
  }

  const cached = getCachedUsage(chatId);
  if (cached) {
    const activeTokens = getActiveContextTokens(cached);
    const totalTokens = getTotalUsageTokens(cached);
    const pct = getContextUsagePercent(cached);
    const bar = getProgressBar(pct);

    const output = `**Context Usage**\n\n`
      + `${bar} **${pct}%** of context window\n\n`
      + `• **Model:** ${cached.model}\n`
      + `• **Input tokens:** ${fmtTokens(cached.inputTokens)}\n`
      + `• **Output tokens:** ${fmtTokens(cached.outputTokens)}\n`
      + `• **Cache read:** ${fmtTokens(cached.cacheReadTokens)}\n`
      + `• **Cache write:** ${fmtTokens(cached.cacheWriteTokens)}\n`
      + `• **Total tokens:** ${fmtTokens(totalTokens)}\n`
      + `• **Context window:** ${fmtTokens(cached.contextWindow)}\n`
      + `• **Turns this session:** ${cached.numTurns}\n`
      + `• **Cost this query:** $${cached.totalCostUsd.toFixed(4)}\n\n`
      + `_Data from last query. Send a message then run /context for fresh data._`;

    await interaction.reply(output);
    return;
  }

  if (!session.claudeSessionId) {
    await interaction.reply({
      content: 'No Claude session ID found. Send a message to Claude first, then run `/context` again.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const raw = await runClaudeContext(session.claudeSessionId, session.workingDirectory);
    const formatted = parseContextOutput(raw);
    await interaction.editReply(formatted);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply(`Error fetching context: ${message}`);
  }
}
