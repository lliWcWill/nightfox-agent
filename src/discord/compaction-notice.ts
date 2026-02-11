import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

/** A channel that supports sending messages. */
type SendableChannel = { send: (...args: any[]) => Promise<any> };

/**
 * Format a token count into a compact human-readable string.
 *
 * @param n - The token count to format
 * @returns A compact string using `k` for thousands and `M` for millions (one decimal place when abbreviated), or the integer as a string for smaller values
 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Notify a Discord channel with an embed describing a context compaction event.
 *
 * The embed indicates whether compaction was automatic or manual and shows the
 * previous context size in human-readable tokens.
 *
 * @param channel - The channel (or channel-like object) used to send the embed
 * @param compaction - Details about the compaction: `trigger` is `'manual'` or `'auto'`, and `preTokens` is the token count before compaction
 */
export async function sendCompactionNotice(
  channel: SendableChannel,
  compaction: { trigger: 'manual' | 'auto'; preTokens: number } | undefined,
): Promise<void> {
  if (!config.CONTEXT_NOTIFY_COMPACTION || !compaction) return;

  const isAuto = compaction.trigger === 'auto';
  const embed = new EmbedBuilder()
    .setColor(isAuto ? 0xFFA500 : 0x5865F2) // orange for auto, blurple for manual
    .setTitle(`${isAuto ? '⚠️' : 'ℹ️'} Context Compacted`)
    .setDescription(
      `**${isAuto ? 'Auto-compacted' : 'Manually compacted'}** — previous context was **${fmtTokens(compaction.preTokens)} tokens**.\n`
      + `The agent now has a summarized version of the conversation.\n\n`
      + `*Tip: Use \`/handoff\` before compaction to save a detailed context document.*`,
    )
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[Discord] Failed to send compaction notice:', err);
  }
}

/**
 * Notifies a Discord channel when an agent starts a new session (session ID changes).
 *
 * Does nothing if compaction notifications are disabled, `sessionInit` is missing, or the new session ID
 * is the same as `previousSessionId`. When sent, the message notes the model used and warns that the
 * agent may not remember earlier details.
 *
 * @param sessionInit - Object containing the new session's `model` and `sessionId`
 * @param previousSessionId - The prior session ID to compare against; notification is skipped if absent or unchanged
 */
export async function sendSessionInitNotice(
  channel: SendableChannel,
  sessionInit: { model: string; sessionId: string } | undefined,
  previousSessionId?: string,
): Promise<void> {
  if (!config.CONTEXT_NOTIFY_COMPACTION || !sessionInit) return;

  if (!previousSessionId || sessionInit.sessionId === previousSessionId) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔄 New Agent Session')
    .setDescription(
      `A new agent session has started (previous context may be summarized).\n`
      + `Model: \`${sessionInit.model}\`\n\n`
      + `*The agent may not remember earlier details. Consider sharing context.*`,
    )
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[Discord] Failed to send session init notice:', err);
  }
}