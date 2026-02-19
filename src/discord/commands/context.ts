import { ChatInputCommandInteraction } from 'discord.js';
import { execFile } from 'child_process';
import { discordChatId } from '../id-mapper.js';
import { sessionManager } from '../../claude/session-manager.js';
import { getCachedUsage } from '../../claude/agent.js';
import { config } from '../../config.js';

/**
 * Format a token count into a compact, human-readable string using metric suffixes.
 *
 * @param n - The token count to format
 * @returns For values >= 1,000,000: a string like `X.XM`; for values >= 1,000: `X.Xk`; otherwise the integer as a string
 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

/**
 * Render a 10-segment progress bar prefixed with a colored status emoji.
 *
 * @param pct - Percentage value (expected 0–100); values outside this range are clamped.
 * @returns A string containing a color emoji (`🟢`, `🟡`, or `🔴`) followed by a bracketed bar of ten segments where filled segments are `█` and empty segments are `░`.
 */
function getProgressBar(pct: number): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round(clamped / 10);
  const empty = 10 - filled;
  const color = clamped >= 80 ? '🔴' : clamped >= 60 ? '🟡' : '🟢';
  return color + ' [' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

/**
 * Parse raw Claude `/context` CLI output into a concise, user-facing summary.
 *
 * Parses the input for a model line, a total/tokens line, and per-category token usage
 * (lines matching `name  tokens  (percent)`) and formats those pieces into a markdown-friendly
 * "Context Usage" report. If no parseable structured data is found, returns a raw snippet.
 *
 * @param raw - Raw stdout/stderr text produced by the Claude CLI `/context` request
 * @returns A formatted summary containing model, total tokens line, and per-category usage when parseable; the literal string `"No context output received."` if `raw` is empty; otherwise a code block with the first 1800 characters of the raw output when structured data could not be parsed.
 */
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
    // Couldn't parse structured output — return raw
    return `**Context Output**\n\`\`\`\n${trimmed.slice(0, 1800)}\n\`\`\``;
  }

  return parts.join('\n');
}

/**
 * Fetches the Claude session context by invoking the Claude CLI `/context` command for a given session.
 *
 * @param sessionId - The Claude session identifier to query.
 * @param cwd - Working directory to run the Claude executable in.
 * @returns The trimmed CLI output (stdout if present, otherwise stderr) from the `/context` command.
 * @throws An `Error` containing the CLI stderr or the underlying process error message if the command fails or exits with an error.
 */
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

/**
 * Handle the `/context` command by presenting current Claude session context usage.
 *
 * Replies with cached context usage when available; otherwise queries the Claude CLI
 * for live context and updates the interaction with the formatted result.
 *
 * If no active session exists, replies ephemerally instructing the user to start one.
 * If a Claude session ID is missing, replies ephemerally instructing the user to send a message to Claude first.
 * On CLI errors, edits the deferred reply with an error message.
 *
 * @param interaction - The Discord chat input interaction that invoked the command
 */
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

  // Try cached SDK usage first (instant)
  const cached = getCachedUsage(chatId);
  if (cached) {
    // Active context = input + output (cache reads are stored outside the active window)
    const activeTokens = cached.inputTokens + cached.outputTokens;
    const totalTokens = activeTokens + cached.cacheReadTokens + cached.cacheWriteTokens;
    const pct = cached.contextWindow > 0
      ? Math.round((activeTokens / cached.contextWindow) * 100)
      : 0;
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

  // Fallback: CLI shell-out
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