import { Message, AttachmentBuilder } from 'discord.js';
import { config } from '../config.js';
import { generateSpeech } from '../tts/tts.js';
import { getTTSSettings, isTTSEnabled } from '../tts/tts-settings.js';
import { discordChatId } from './id-mapper.js';

/**
 * Remove common Markdown constructs from a string.
 *
 * @param input - The Markdown-formatted text to clean
 * @returns The cleaned text with code blocks removed, inline code backticks removed, Markdown links replaced by their link text, emphasis/strikethrough markers removed, headings, block quotes, and list markers stripped, consecutive blank lines collapsed, and leading/trailing whitespace trimmed
 */
function stripMarkdown(input: string): string {
  let text = input;
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/[\*_~]/g, '');
  text = text.replace(/^#+\s+/gm, '');
  text = text.replace(/^>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/\n{2,}/g, '\n');
  return text.trim();
}

/**
 * Detects whether the string begins with a common error indicator.
 *
 * @param text - The input string to evaluate (leading/trailing whitespace is ignored)
 * @returns `true` if the trimmed text starts with `❌`, `⚠️`, or `Error:`, `false` otherwise
 */
function looksLikeError(text: string): boolean {
  return /^(❌|⚠️|Error:)/.test(text.trim());
}

/**
 * Truncates `text` to at most `maxChars` characters, preferring to cut at a sentence boundary when appropriate.
 *
 * @param text - The input string to truncate
 * @param maxChars - Maximum allowed characters for the returned string
 * @returns The original `text` if its length is less than or equal to `maxChars`; otherwise a truncated version. If truncation occurs and a sentence-ending punctuation (`.`, `!`, or `?`) exists after character 200 within the first `maxChars` characters, the result is shortened to end at that punctuation.
 */
function truncateToMax(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastPeriod = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?')
  );
  if (lastPeriod > 200) return truncated.slice(0, lastPeriod + 1);
  return truncated;
}

/**
 * Selects the audio file extension used for TTS output based on configuration.
 *
 * @returns `'ogg'` for the Groq provider or when the configured response format is `'opus'`; otherwise the configured `TTS_RESPONSE_FORMAT` or `'mp3'` if none is set.
 */
function getTTSFileExtension(): string {
  if (config.TTS_PROVIDER === 'groq') return 'ogg';
  if (config.TTS_RESPONSE_FORMAT === 'opus') return 'ogg';
  return config.TTS_RESPONSE_FORMAT || 'mp3';
}

/**
 * If TTS is enabled for this user, generate speech from the response
 * and send as an audio attachment in Discord.
 */
export async function maybeSendDiscordVoiceReply(
  message: Message,
  text: string,
): Promise<void> {
  const chatId = discordChatId(message.author.id);
  if (!isTTSEnabled(chatId)) return;

  const hasKey = config.TTS_PROVIDER === 'groq' ? !!config.GROQ_API_KEY : !!config.OPENAI_API_KEY;
  if (!hasKey) return;
  if (looksLikeError(text)) return;

  const cleaned = stripMarkdown(text);
  if (cleaned.length < 5) return;

  const safeText = truncateToMax(cleaned, config.TTS_MAX_CHARS);
  if (!safeText) return;

  try {
    const settings = getTTSSettings(chatId);
    const audioBuffer = await generateSpeech(safeText, settings.voice);
    const ext = getTTSFileExtension();
    const attachment = new AttachmentBuilder(audioBuffer, { name: `response.${ext}` });

    if ('send' in message.channel) {
      await message.channel.send({ files: [attachment] });
    }
  } catch (error) {
    console.error('[Discord TTS] Failed to generate or send voice reply:', error);
  }
}

/**
 * Variant for interaction-based flows (slash commands).
 * Sends TTS audio as a follow-up in the given channel.
 */
export async function maybeSendDiscordVoiceReplyToChannel(
  userId: string,
  channelId: string,
  text: string,
): Promise<void> {
  const { getDiscordClient } = await import('./discord-bot.js');
  const chatId = discordChatId(userId);
  if (!isTTSEnabled(chatId)) return;

  const hasKey = config.TTS_PROVIDER === 'groq' ? !!config.GROQ_API_KEY : !!config.OPENAI_API_KEY;
  if (!hasKey) return;
  if (looksLikeError(text)) return;

  const cleaned = stripMarkdown(text);
  if (cleaned.length < 5) return;

  const safeText = truncateToMax(cleaned, config.TTS_MAX_CHARS);
  if (!safeText) return;

  try {
    const settings = getTTSSettings(chatId);
    const audioBuffer = await generateSpeech(safeText, settings.voice);
    const ext = getTTSFileExtension();
    const attachment = new AttachmentBuilder(audioBuffer, { name: `response.${ext}` });

    const client = getDiscordClient();
    const channel = await client?.channels.fetch(channelId);
    if (channel && 'send' in channel) {
      await channel.send({ files: [attachment] });
    }
  } catch (error) {
    console.error('[Discord TTS] Failed to generate or send voice reply:', error);
  }
}