import {
  ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  TextChannel,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { discordChatId } from '../id-mapper.js';
import { discordConfig } from '../discord-config.js';
import { discordMessageSender } from '../message-sender.js';
import { sendToAgent } from '../../claude/agent.js';
import { sessionManager } from '../../claude/session-manager.js';
import { queueRequest, setAbortController } from '../../claude/request-queue.js';
import {
  extractMedia,
  cleanupExtractResult,
  detectPlatform,
  platformLabel,
  isValidUrl,
  type ExtractMode,
  type ExtractResult,
} from '../../media/extract.js';
import { sanitizeError } from '../../utils/sanitize.js';
import {
  type BrowserState,
  BROWSER_TIMEOUT,
  getBrowserRoot,
  buildBrowserUI,
  isWithinRoot,
  setProject,
} from '../project-browser.js';

const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;
const EXTRACT_BROWSER_PREFIX = 'extproj'; /**
 * Maps a platform identifier to a platform-specific emoji.
 *
 * @param platform - The platform identifier; expected values include `'youtube'`, `'instagram'`, and `'tiktok'`
 * @returns The emoji string for the given platform, or a link icon emoji when the platform is unrecognized
 */

function platformEmoji(platform: string): string {
  switch (platform) {
    case 'youtube': return '\u{25B6}\u{FE0F}';
    case 'instagram': return '\u{1F4F7}';
    case 'tiktok': return '\u{1F3B5}';
    default: return '\u{1F517}';
  }
}

/**
 * Create a filesystem-safe filename from a title.
 *
 * @param title - The original title to convert into a safe filename
 * @returns The sanitized filename where characters not allowed in filenames are replaced with underscores and the result is truncated to 40 characters
 */
function safeFileName(title: string): string {
  return title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

/**
 * Persist transcript to the active project's .claudegram/extract folder.
 * Returns both abs + rel path (rel is what the agent should see).
 */
async function persistTranscriptArtifact(
  chatId: number,
  result: ExtractResult,
): Promise<{ relPath: string; absPath: string } | null> {
  try {
    const session = sessionManager.getSession(chatId);
    if (!session) return null;
    if (!result.transcript || !result.transcript.trim()) return null;

    const baseDir = session.workingDirectory;
    const dir = path.join(baseDir, '.claudegram', 'extract');
    await fs.promises.mkdir(dir, { recursive: true });

    const slug = safeFileName(result.title || 'extract');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `transcript_${slug}_${stamp}.txt`;
    const absPath = path.join(dir, filename);
    await fs.promises.writeFile(absPath, result.transcript, 'utf-8');

    const relPath = `.claudegram/extract/${filename}`;
    return { relPath, absPath };
  } catch (err) {
    console.warn('[extract] Failed to persist transcript artifact:', err);
    return null;
  }
}

function buildExtractContextMessage(params: {
  modeLabel: string;
  url: string;
  title: string;
  platform: string;
  transcriptRelPath?: string;
  transcriptChars?: number;
  durationStr?: string;
}): string {
  const { modeLabel, url, title, platform, transcriptRelPath, transcriptChars, durationStr } = params;

  return (
    `[Extract Context — ${modeLabel}]\n` +
    `URL: ${url}\n` +
    `Title: ${title}\n` +
    `Platform: ${platform}\n` +
    (durationStr ? `Duration: ${durationStr}\n` : '') +
    (transcriptRelPath
      ? `Transcript saved to: ${transcriptRelPath} (${(transcriptChars ?? 0).toLocaleString()} chars)\n`
      : 'Transcript: (not available)\n') +
    `\nInstructions:\n` +
    `- Do NOT ask me to paste the transcript into chat.\n` +
    `- If you need the transcript, use the read_file tool to read the saved transcript file in chunks.\n` +
    `- Start by acknowledging the extract and asking what the user wants to do (summary, key claims, outline, timestamps, etc.).`
  );
}

/**
 * Compresses a video to fit within a target size and writes the result to the specified output directory.
 *
 * @param inputPath - Path to the source video file.
 * @param outputDir - Directory where the compressed file will be created.
 * @param maxSizeMB - Maximum allowed file size in megabytes for the compressed output.
 * @returns The path to the compressed file if compression succeeds, or `null` if compression fails or the output file is not produced.
 */
function compressVideo(inputPath: string, outputDir: string, maxSizeMB: number): Promise<string | null> {
  return new Promise((resolve) => {
    const outPath = path.join(outputDir, 'compressed.mp4');
    const targetBitrate = Math.floor((maxSizeMB * 8 * 1024) / 60); // rough: assume 60s max
    execFile('ffmpeg', [
      '-y', '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k',
      '-maxrate', `${targetBitrate}k`, '-bufsize', `${targetBitrate * 2}k`,
      '-movflags', '+faststart',
      '-fs', `${maxSizeMB * 1024 * 1024}`,
      outPath,
    ], { timeout: 120_000 }, (error) => {
      if (error || !fs.existsSync(outPath)) {
        resolve(null);
      } else {
        resolve(outPath);
      }
    });
  });
}

/**
 * Create two action rows of disabled mode-selection buttons for the post-selection UI state.
 *
 * @returns A tuple where the first element is an action row containing the Text, Audio, and Video buttons (all disabled), and the second element is an action row containing the All and All + Chat buttons (all disabled).
 */
function disabledRows(): [ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<ButtonBuilder>] {
  const r1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('extract-text').setLabel('\u{1F4DD} Text').setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId('extract-audio').setLabel('\u{1F3A7} Audio').setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId('extract-video').setLabel('\u{1F3AC} Video').setStyle(ButtonStyle.Primary).setDisabled(true),
  );
  const r2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('extract-all').setLabel('\u{2728} All').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('extract-all_chat').setLabel('\u{1F4AC} All + Chat').setStyle(ButtonStyle.Success).setDisabled(true),
  );
  return [r1, r2];
}

/**
 * Compresses an audio file with ffmpeg to produce an MP3 that does not exceed a given size.
 *
 * @param inputPath - Filesystem path to the source audio file
 * @param outputDir - Directory where the compressed file will be written
 * @param maxSizeMB - Maximum allowed output file size in megabytes
 * @returns Path to the compressed MP3 if successful, `null` on error or if the output file is not created
 */
function compressAudio(inputPath: string, outputDir: string, maxSizeMB: number): Promise<string | null> {
  return new Promise((resolve) => {
    const outPath = path.join(outputDir, 'compressed.mp3');
    execFile('ffmpeg', [
      '-y', '-i', inputPath,
      '-c:a', 'libmp3lame', '-b:a', '96k', // aggressive compression for Discord
      '-fs', `${maxSizeMB * 1024 * 1024}`,
      outPath,
    ], { timeout: 120_000 }, (error) => {
      if (error || !fs.existsSync(outPath)) {
        resolve(null);
      } else {
        resolve(outPath);
      }
    });
  });
}

const DISCORD_MAX_UPLOAD_MB = 25; // free-tier per-file limit

/**
 * Deliver extracted media (video, audio, transcript, subtitles) to a channel or interaction follow-up according to the requested mode.
 *
 * Sends video, audio, and text outputs based on `mode`. Videos and audio are checked against size limits and will be re-encoded to meet limits when possible; transcripts under 2000 characters are posted inline, otherwise sent as a text file; subtitles are sent as a file. Sending is attempted via the provided `sender` (if present) or the `interaction` follow-up, and upload failures trigger a user-facing warning message when possible.
 *
 * @param result - Extraction result containing fields used for delivery (e.g., `videoPath`, `audioPath`, `transcript`, `subtitlePath`, `subtitleFormat`, `title`)
 * @param mode - Desired output mode: `'text'`, `'audio'`, `'video'`, `'all'`, or `'all_chat'`
 * @param maxVideoMB - Maximum allowed video size in megabytes for direct upload; videos larger than this will be re-encoded attempting to fit this limit
 */
async function sendMediaFiles(
  result: ExtractResult,
  mode: ExtractMode,
  sender: { send: (opts: any) => Promise<any> } | null,
  interaction: ChatInputCommandInteraction | null,
  maxVideoMB: number,
): Promise<void> {
  const send = async (opts: any) => {
    try {
      if (sender) {
        await sender.send(opts);
      } else if (interaction) {
        await interaction.followUp(opts);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error('[extract] Failed to send media:', errMsg);
      // Notify user about the failure
      const label = opts.content?.slice(0, 50) || 'file';
      const warning = `\u{26A0}\u{FE0F} Failed to upload ${label}: ${errMsg.includes('entity too large') ? 'file exceeds Discord\u2019s 25MB upload limit' : errMsg}`;
      try {
        if (sender) {
          await sender.send({ content: warning });
        } else if (interaction) {
          await interaction.followUp({ content: warning });
        }
      } catch { /* can't even send the warning */ }
    }
  };

  const maxUploadBytes = DISCORD_MAX_UPLOAD_MB * 1024 * 1024;
  const wantsVideo = mode === 'video' || mode === 'all' || mode === 'all_chat';
  const wantsAudio = mode === 'audio' || mode === 'all' || mode === 'all_chat';
  const wantsText = mode === 'text' || mode === 'all' || mode === 'all_chat';

  // Video
  if (wantsVideo && result.videoPath && fs.existsSync(result.videoPath)) {
    let videoPath = result.videoPath;
    let videoSize = fs.statSync(videoPath).size;
    const maxBytes = maxVideoMB * 1024 * 1024;

    // Compress if over Discord limit
    if (videoSize > maxBytes) {
      const compressed = await compressVideo(videoPath, path.dirname(videoPath), maxVideoMB);
      if (compressed && fs.existsSync(compressed)) {
        videoPath = compressed;
        videoSize = fs.statSync(compressed).size;
      }
    }

    if (videoSize <= maxBytes) {
      const sizeMB = (videoSize / 1024 / 1024).toFixed(1);
      const attachment = new AttachmentBuilder(videoPath, {
        name: `${safeFileName(result.title)}.mp4`,
      });
      await send({ content: `\u{1F3AC} Video (${sizeMB}MB)`, files: [attachment] });
    } else {
      await send({ content: `\u{26A0}\u{FE0F} Video too large (${(videoSize / 1024 / 1024).toFixed(1)}MB) \u2014 exceeds ${maxVideoMB}MB limit even after compression.` });
    }
  }

  // Audio — check size and compress if needed
  if (wantsAudio && result.audioPath && fs.existsSync(result.audioPath)) {
    let audioPath = result.audioPath;
    let audioSize = fs.statSync(audioPath).size;

    if (audioSize > maxUploadBytes) {
      const compressed = await compressAudio(audioPath, path.dirname(audioPath), DISCORD_MAX_UPLOAD_MB);
      if (compressed && fs.existsSync(compressed)) {
        audioPath = compressed;
        audioSize = fs.statSync(compressed).size;
      }
    }

    if (audioSize <= maxUploadBytes) {
      const sizeMB = (audioSize / 1024 / 1024).toFixed(1);
      const attachment = new AttachmentBuilder(audioPath, {
        name: `${safeFileName(result.title)}.mp3`,
      });
      await send({ content: `\u{1F3A7} Audio (${sizeMB}MB)`, files: [attachment] });
    } else {
      await send({ content: `\u{26A0}\u{FE0F} Audio too large (${(audioSize / 1024 / 1024).toFixed(1)}MB) \u2014 exceeds ${DISCORD_MAX_UPLOAD_MB}MB Discord upload limit.` });
    }
  }

  // Transcript
  if (wantsText && result.transcript) {
    if (result.transcript.length <= 2000) {
      await send({ content: `\u{1F4DD} **Transcript:**\n\n${result.transcript}` });
    } else {
      const txtBuffer = Buffer.from(result.transcript, 'utf-8');
      const attachment = new AttachmentBuilder(txtBuffer, { name: 'transcript.txt' });
      await send({
        content: `\u{1F4DD} Transcript (${result.transcript.length.toLocaleString()} chars)`,
        files: [attachment],
      });
    }
  }

  // Subtitle file
  if (wantsText && result.subtitlePath && fs.existsSync(result.subtitlePath)) {
    const attachment = new AttachmentBuilder(result.subtitlePath, {
      name: path.basename(result.subtitlePath),
    });
    await send({
      content: `\u{1F4C4} Subtitles (${result.subtitleFormat?.toUpperCase() || 'SRT'})`,
      files: [attachment],
    });
  }
}

/**
 * Present an ephemeral directory browser allowing the command user to choose a project directory.
 *
 * Shows an interactive, paginated directory picker (with manual-path modal), stores the selected project for the chat when confirmed, and closes the UI.
 *
 * @param interaction - The originating command interaction used to send the ephemeral picker UI
 * @param chatId - Numeric chat identifier used to persist the chosen project for the chat
 * @returns The chosen directory path as a string, or `null` if the user cancelled or the picker timed out
 */
async function promptProjectPicker(
  interaction: ChatInputCommandInteraction,
  chatId: number,
): Promise<string | null> {
  const root = getBrowserRoot();
  const state: BrowserState = { root, current: root, page: 0 };
  const prefix = EXTRACT_BROWSER_PREFIX;

  const ui = buildBrowserUI(state, prefix);
  const pickerMsg = await interaction.followUp({
    content:
      '\u{1F4C1} **All + Chat needs a project directory.**\n' +
      'Pick one below and extraction will start automatically.\n\n' +
      ui.content,
    components: ui.components,
    ephemeral: true,
  });

  return new Promise<string | null>((resolve) => {
    const collector = pickerMsg.createMessageComponentCollector({ time: BROWSER_TIMEOUT });
    let resolved = false;

    const finish = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      collector.stop();
      resolve(result);
    };

    collector.on('collect', async (bi) => {
      try {
        // Directory select — navigate into
        if (bi.isStringSelectMenu() && bi.customId === `${prefix}-dir-select`) {
          const selected = bi.values[0];
          const nextPath = path.join(state.current, selected);
          if (fs.existsSync(nextPath) && fs.statSync(nextPath).isDirectory()) {
            state.current = nextPath;
            state.page = 0;
          }
          const updated = buildBrowserUI(state, prefix);
          await bi.update({ content: updated.content, components: updated.components });
          return;
        }

        if (!bi.isButton()) return;

        switch (bi.customId) {
          case `${prefix}-up`: {
            const parent = path.dirname(state.current);
            if (parent !== state.current) {
              state.current = parent;
              state.page = 0;
            }
            const updated = buildBrowserUI(state, prefix);
            await bi.update({ content: updated.content, components: updated.components });
            break;
          }

          case `${prefix}-use`: {
            const dirPath = state.current;
            const confirmMsg = setProject(chatId, dirPath);
            await bi.update({ content: `${confirmMsg}\n\n\u{23F3} Starting extraction\u2026`, components: [] });
            finish(dirPath);
            break;
          }

          case `${prefix}-prev`: {
            state.page = Math.max(0, state.page - 1);
            const updated = buildBrowserUI(state, prefix);
            await bi.update({ content: updated.content, components: updated.components });
            break;
          }

          case `${prefix}-next`: {
            state.page += 1;
            const updated = buildBrowserUI(state, prefix);
            await bi.update({ content: updated.content, components: updated.components });
            break;
          }

          case `${prefix}-manual`: {
            const modal = new ModalBuilder()
              .setCustomId(`${prefix}-modal-${interaction.user.id}`)
              .setTitle('Enter Project Path');

            const input = new TextInputBuilder()
              .setCustomId(`${prefix}-path-input`)
              .setLabel('Directory path')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('/home/user/projects/myapp')
              .setValue(state.current)
              .setRequired(true);

            modal.addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(input),
            );

            await bi.showModal(modal);

            try {
              const modalSubmit = await bi.awaitModalSubmit({ time: 60_000 });
              let inputPath = modalSubmit.fields.getTextInputValue(`${prefix}-path-input`).trim();

              if (inputPath.startsWith('~')) {
                inputPath = path.join(process.env.HOME || '', inputPath.slice(1));
              }
              inputPath = path.resolve(inputPath);

              if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isDirectory()) {
                await modalSubmit.reply({
                  content: `Not a valid directory: \`${inputPath}\``,
                  ephemeral: true,
                });
                return;
              }

              const confirmMsg = setProject(chatId, inputPath);
              if (modalSubmit.isFromMessage()) {
                await modalSubmit.update({ content: `${confirmMsg}\n\n\u{23F3} Starting extraction\u2026`, components: [] });
              } else {
                await modalSubmit.reply({ content: `${confirmMsg}\n\n\u{23F3} Starting extraction\u2026`, components: [], ephemeral: true });
              }
              finish(inputPath);
            } catch {
              // Modal timed out
            }
            break;
          }
        }
      } catch (error) {
        console.error('[Discord] Extract project picker error:', error);
      }
    });

    collector.on('end', (_collected, reason) => {
      if (!resolved) {
        finish(null); // timed out
      }
    });
  });
}

async function runAllChatExtraction(
  interaction: ChatInputCommandInteraction,
  url: string,
  emoji: string,
  label: string,
  displayUrl: string,
  maxVideoMB: number,
  chatId: number,
): Promise<void> {
  const modeLabel = 'All + Chat';

  const progressEmbed = new EmbedBuilder()
    .setTitle(`${emoji} Extract — ${modeLabel}`)
    .setDescription(`\`${displayUrl}\`\n\n\u{23F3} Extracting...`)
    .setColor(0x5865F2);

  await interaction.editReply({ embeds: [progressEmbed], components: disabledRows() });

  let result: ExtractResult | null = null;

  try {
    result = await extractMedia({
      url,
      mode: 'all_chat',
      onProgress: async (msg) => {
        try {
          const updatedEmbed = new EmbedBuilder()
            .setTitle(`${emoji} Extract — ${modeLabel}`)
            .setDescription(`\`${displayUrl}\`\n\n${msg}`)
            .setColor(0x5865F2);
          await interaction.editReply({ embeds: [updatedEmbed], components: disabledRows() });
        } catch { /* ignore progress update failures */ }
      },
    });

    // Update embed to done
    const doneEmbed = new EmbedBuilder()
      .setTitle(`${emoji} ${result.title}`)
      .setDescription(`\`${displayUrl}\``)
      .setColor(0x57F287)
      .setFooter({ text: `${label} — ${modeLabel}` });

    if (result.warnings.length > 0) {
      doneEmbed.addFields({ name: 'Warnings', value: result.warnings.join('\n').slice(0, 1024) });
    }

    await interaction.editReply({ embeds: [doneEmbed], components: disabledRows() });

    // Create thread — resolve to a text channel that supports threads
    const threadTitle = `\u{1F4E5} ${(result.title || 'Extract').slice(0, 90)}`;
    let threadParent = interaction.channelId
      ? await interaction.client.channels.fetch(interaction.channelId).catch(() => null)
      : null;

    // If command was run inside a thread, use its parent text channel
    if (threadParent && 'parentId' in threadParent && threadParent.parentId && !('threads' in threadParent)) {
      threadParent = await interaction.client.channels.fetch(threadParent.parentId).catch(() => null);
    }

    if (!threadParent || !('threads' in threadParent)) {
      await interaction.followUp({ content: 'Cannot create thread in this channel type.', ephemeral: true });
      return;
    }

    const thread = await (threadParent as TextChannel).threads.create({
      name: threadTitle.slice(0, 100),
      autoArchiveDuration: 1440,
    });

    await interaction.followUp(`Thread created: ${thread.toString()}`);

    // Post info header in the thread
    const durationStr = result.duration
      ? `${Math.floor(result.duration / 60)}:${String(Math.floor(result.duration % 60)).padStart(2, '0')}`
      : 'unknown';
    await thread.send(
      `${emoji} **${result.title}**\n` +
      `${url}\n` +
      `(${durationStr})`,
    );

    // Post all media inside the thread
    await sendMediaFiles(result, 'all_chat', thread, null, maxVideoMB);

    // Persist transcript to project workspace as an artifact (so we don't inject it into context)
    const artifact = await persistTranscriptArtifact(chatId, result);

    const contextMessage = buildExtractContextMessage({
      modeLabel: 'All + Chat',
      url,
      title: result.title,
      platform: label,
      transcriptRelPath: artifact?.relPath,
      transcriptChars: result.transcript?.length,
      durationStr,
    });

    const threadChannelId = thread.id;
    const thinkingEmbed = new EmbedBuilder().setColor(0x5865F2).setDescription('**\u{25CF}\u{25CB}\u{25CB}** Processing');
    const thinkingMsg = await thread.send({ embeds: [thinkingEmbed] });
    await discordMessageSender.startStreamingFromExistingMessage(thinkingMsg, threadChannelId);

    await queueRequest(chatId, contextMessage, async () => {
      const abortController = new AbortController();
      setAbortController(chatId, abortController);

      try {
        const agentResponse = await sendToAgent(chatId, contextMessage, {
          onProgress: (text) => {
            discordMessageSender.updateStream(threadChannelId, text);
          },
          onToolStart: (toolName, input) => {
            discordMessageSender.updateToolOperation(threadChannelId, toolName, input);
          },
          onToolEnd: () => {
            discordMessageSender.clearToolOperation(threadChannelId);
          },
          abortController,
          platform: 'discord',
        });

        await discordMessageSender.finishStreaming(threadChannelId, agentResponse.text);
      } catch (error) {
        await discordMessageSender.cancelStreaming(threadChannelId);
        throw error;
      }
    });
  } catch (err) {
    const errorEmbed = new EmbedBuilder()
      .setTitle(`${emoji} Extract Failed`)
      .setDescription(`\`${displayUrl}\`\n\n\u{274C} ${sanitizeError(err)}`)
      .setColor(0xFF0000);

    try {
      await interaction.editReply({ embeds: [errorEmbed], components: disabledRows() });
    } catch {
      try {
        await interaction.followUp({ content: `Error: ${sanitizeError(err)}`, ephemeral: true });
      } catch { /* interaction expired */ }
    }
  } finally {
    if (result) cleanupExtractResult(result);
  }
}

export async function handleExtract(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString('url', true);

  if (!isValidUrl(url)) {
    await interaction.reply({
      content: 'Invalid or unsupported URL. Supported: YouTube, Instagram, TikTok.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const platform = detectPlatform(url);
  const emoji = platformEmoji(platform);
  const label = platformLabel(platform);
  const displayUrl = url.length > 60 ? url.slice(0, 57) + '...' : url;
  const maxVideoMB = discordConfig.DISCORD_VIDEO_MAX_SIZE_MB;

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Extract — ${label}`)
    .setDescription(`\`${displayUrl}\`\n\nWhat do you want to extract?`)
    .setColor(0x5865F2)
    .setFooter({ text: 'Select a mode below' });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('extract-text').setLabel('\u{1F4DD} Text').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('extract-audio').setLabel('\u{1F3A7} Audio').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('extract-video').setLabel('\u{1F3AC} Video').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('extract-all').setLabel('\u{2728} All').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('extract-all_chat').setLabel('\u{1F4AC} All + Chat').setStyle(ButtonStyle.Success),
  );

  const response = await interaction.editReply({
    content: '',
    embeds: [embed],
    components: [row1, row2],
  });

  const collector = response.createMessageComponentCollector({
    time: COLLECTOR_TIMEOUT_MS,
  });

  let handled = false;

  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: 'Only the command author can use these buttons.', ephemeral: true });
      return;
    }

    if (handled) return;
    handled = true;
    collector.stop('handled');

    const mode = i.customId.replace('extract-', '') as ExtractMode;

    // ── All + Chat: check project first ──────────────────────────────
    if (mode === 'all_chat') {
      const chatId = discordChatId(interaction.user.id);
      const session = sessionManager.getSession(chatId);

      if (!session) {
        // Disable buttons while they pick a project
        const [dr1, dr2] = disabledRows();
        const waitEmbed = new EmbedBuilder()
          .setTitle(`${emoji} Extract — All + Chat`)
          .setDescription(`\`${displayUrl}\`\n\n\u{1F4C1} Pick a project directory to continue.`)
          .setColor(0xFEE75C);

        await i.update({ embeds: [waitEmbed], components: [dr1, dr2] });

        // Show ephemeral directory picker
        const chosenDir = await promptProjectPicker(interaction, chatId);

        if (!chosenDir) {
          // Timed out or cancelled — reset embed
          const cancelEmbed = new EmbedBuilder()
            .setTitle(`${emoji} Extract — Cancelled`)
            .setDescription(`\`${displayUrl}\`\n\nNo project selected. Use \`/project\` to set one, then try again.`)
            .setColor(0xFF0000);
          try {
            await interaction.editReply({ embeds: [cancelEmbed], components: disabledRows() });
          } catch { /* ignore */ }
          return;
        }

        // Project is now set — proceed with extraction
        await runAllChatExtraction(interaction, url, emoji, label, displayUrl, maxVideoMB, chatId);
        return;
      }

      // Project already set — proceed directly
      const [dr1, dr2] = disabledRows();
      const progressEmbed = new EmbedBuilder()
        .setTitle(`${emoji} Extract — All + Chat`)
        .setDescription(`\`${displayUrl}\`\n\n\u{23F3} Extracting...`)
        .setColor(0x5865F2);

      await i.update({ embeds: [progressEmbed], components: [dr1, dr2] });
      await runAllChatExtraction(interaction, url, emoji, label, displayUrl, maxVideoMB, chatId);
      return;
    }

    // ── Standard modes (Text, Audio, Video, All) ─────────────────────
    const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
    const [disabledRow1, disabledRow2] = disabledRows();

    const progressEmbed = new EmbedBuilder()
      .setTitle(`${emoji} Extract — ${modeLabel}`)
      .setDescription(`\`${displayUrl}\`\n\n\u{23F3} Extracting...`)
      .setColor(0x5865F2);

    await i.update({ embeds: [progressEmbed], components: [disabledRow1, disabledRow2] });

    let result: ExtractResult | null = null;

    try {
      result = await extractMedia({
        url,
        mode,
        onProgress: async (msg) => {
          try {
            const updatedEmbed = new EmbedBuilder()
              .setTitle(`${emoji} Extract — ${modeLabel}`)
              .setDescription(`\`${displayUrl}\`\n\n${msg}`)
              .setColor(0x5865F2);
            await interaction.editReply({ embeds: [updatedEmbed], components: disabledRows() });
          } catch { /* ignore progress update failures */ }
        },
      });

      // Update embed to done
      const doneEmbed = new EmbedBuilder()
        .setTitle(`${emoji} ${result.title}`)
        .setDescription(`\`${displayUrl}\``)
        .setColor(0x57F287)
        .setFooter({ text: `${label} — ${modeLabel}` });

      if (result.warnings.length > 0) {
        doneEmbed.addFields({ name: 'Warnings', value: result.warnings.join('\n').slice(0, 1024) });
      }

      await interaction.editReply({ embeds: [doneEmbed], components: disabledRows() });

      // Post media to channel
      await sendMediaFiles(result, mode, null, interaction, maxVideoMB);

      // Mirror Reddit behavior: if the user has an active project session, allow "Chat" follow-up
      // by persisting transcript as an artifact and starting an AI thread.
      const chatId = discordChatId(interaction.user.id);
      const session = sessionManager.getSession(chatId);
      if (session && (mode === 'all' || mode === 'text')) {
        // Create a minimal "Chat" option UI
        const chatBtn = new ButtonBuilder()
          .setCustomId('extract-chat')
          .setLabel('Chat')
          .setStyle(ButtonStyle.Success);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(chatBtn);

        const msg = await interaction.followUp({
          content: 'Want to chat about this extract?',
          components: [row],
        });

        const c = msg.createMessageComponentCollector({ time: COLLECTOR_TIMEOUT_MS });
        let did = false;
        c.on('collect', async (ci) => {
          if (ci.user.id !== interaction.user.id) {
            await ci.reply({ content: 'Only the command author can use this button.', ephemeral: true });
            return;
          }
          if (did) return;
          did = true;
          c.stop('handled');

          // disable
          const disabled = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('extract-chat').setLabel('Chat').setStyle(ButtonStyle.Success).setDisabled(true),
          );
          await ci.update({ components: [disabled] });

          const artifact = await persistTranscriptArtifact(chatId, result!);

          const thread = await (interaction.channel as TextChannel).threads.create({
            name: `\u{1F4AC} ${(result!.title || 'Extract').slice(0, 90)}`.slice(0, 100),
            autoArchiveDuration: 1440,
          });

          await interaction.followUp(`Thread created: ${thread.toString()}`);

          const contextMessage = buildExtractContextMessage({
            modeLabel: 'Chat',
            url,
            title: result!.title,
            platform: label,
            transcriptRelPath: artifact?.relPath,
            transcriptChars: result!.transcript?.length,
          });

          const thinkingEmbed = new EmbedBuilder().setColor(0x5865F2).setDescription('**\u{25CF}\u{25CB}\u{25CB}** Processing');
          const thinkingMsg = await thread.send({ embeds: [thinkingEmbed] });
          await discordMessageSender.startStreamingFromExistingMessage(thinkingMsg, thread.id);

          await queueRequest(chatId, contextMessage, async () => {
            const abortController = new AbortController();
            setAbortController(chatId, abortController);
            const agentResponse = await sendToAgent(chatId, contextMessage, {
              onProgress: (text) => discordMessageSender.updateStream(thread.id, text),
              onToolStart: (toolName, input) => discordMessageSender.updateToolOperation(thread.id, toolName, input),
              onToolEnd: () => discordMessageSender.clearToolOperation(thread.id),
              abortController,
              platform: 'discord',
            });
            await discordMessageSender.finishStreaming(thread.id, agentResponse.text);
          });
        });
      }

    } catch (err) {
      const errorEmbed = new EmbedBuilder()
        .setTitle(`${emoji} Extract Failed`)
        .setDescription(`\`${displayUrl}\`\n\n\u{274C} ${sanitizeError(err)}`)
        .setColor(0xFF0000);

      try {
        await interaction.editReply({ embeds: [errorEmbed], components: disabledRows() });
      } catch {
        try {
          await interaction.followUp({ content: `Error: ${sanitizeError(err)}`, ephemeral: true });
        } catch { /* interaction expired */ }
      }
    } finally {
      if (result) cleanupExtractResult(result);
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'time' && !handled) {
      try {
        await interaction.editReply({ components: disabledRows() });
      } catch { /* ignore */ }
    }
  });
}
