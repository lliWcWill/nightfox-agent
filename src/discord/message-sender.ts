import {
  ChatInputCommandInteraction,
  Message,
  EmbedBuilder,
  AttachmentBuilder,
  ActivityType,
  TextBasedChannel,
} from 'discord.js';
import { discordConfig } from './discord-config.js';
import { getDiscordClient } from './discord-bot.js';
import { splitDiscordMessage } from './markdown.js';
import {
  getSpinnerFrame,
  getToolIcon,
  renderStatusLine,
  extractToolDetail,
  TOOL_ICONS,
} from '../telegram/terminal-renderer.js';

const ESC = '\x1b';

/**
 * Injects real ESC (U+001B) bytes into triple-backticked ```ansi code blocks in the given text.
 *
 * Converts literal escape representations and ensures bare ANSI sequences inside ```ansi blocks
 * are prefixed with an actual ESC byte so they become proper ANSI escape sequences.
 *
 * @param content - The input text that may contain ```ansi code blocks
 * @returns The input text with ESC bytes injected into ANSI code blocks
 */
function injectAnsiEscapes(content: string): string {
  return content.replace(/```ansi\n([\s\S]*?)```/g, (_match, block: string) => {
    let processed = block;
    // Convert literal \u001b or \x1b text to real ESC byte
    processed = processed.replace(/\\u001b\[/g, ESC + '[');
    processed = processed.replace(/\\x1b\[/g, ESC + '[');
    // Inject ESC before any remaining bare ANSI codes [0m, [1;33m, etc.
    // Negative lookbehind ensures we don't double-inject
    processed = processed.replace(/(?<!\x1b)\[(\d+(?:;\d+)*)m/g, ESC + '[$1m');
    return '```ansi\n' + processed + '```';
  });
}

interface ToolOperation {
  name: string;
  detail?: string;
}

interface DiscordStreamState {
  channelId: string;
  /** The message being edited for streaming. */
  message: Message | null;
  /** The interaction that started this stream (if slash command). */
  interaction: ChatInputCommandInteraction | null;
  content: string;
  lastUpdate: number;
  updateScheduled: boolean;
  // Terminal UI
  spinnerIndex: number;
  spinnerInterval: NodeJS.Timeout | null;
  currentOperation: ToolOperation | null;
  /** Set true when finishStreaming starts — blocks further flushUpdate edits. */
  finished: boolean;
  /** Serializes all message.edit() calls to prevent race conditions. */
  editLock: Promise<void>;
}

const SPINNER_INTERVAL_MS = 1500;
const EMBED_COLOR = 0x7C3AED; // Purple accent
const THINKING_COLOR = 0x5865F2; // Discord blurple
const TOOL_COLOR = 0xEB459E; // Discord fuchsia
const WRITING_COLOR = 0x57F287; // Discord green

// Animated thinking frames — cycles through visually distinct states
const THINKING_FRAMES = [
  { dots: '●○○', text: 'Processing' },
  { dots: '●●○', text: 'Processing.' },
  { dots: '●●●', text: 'Processing..' },
  { dots: '○●●', text: 'Processing...' },
  { dots: '○○●', text: 'Processing..' },
  { dots: '○○○', text: 'Processing.' },
  { dots: '◉○○', text: 'Thinking' },
  { dots: '○◉○', text: 'Thinking.' },
  { dots: '○○◉', text: 'Thinking..' },
  { dots: '◉◉○', text: 'Thinking...' },
  { dots: '○◉◉', text: 'Thinking..' },
  { dots: '◉○◉', text: 'Thinking.' },
];
const EMBED_MAX_DESCRIPTION = 4096;
const MAX_EMBEDS_PER_MESSAGE = 25; // bumped from 10; batching still respects Discord 6000-char/embed-batch limit
const PLAIN_TEXT_THRESHOLD = 2000; // Under this: plain markdown message
// Discord limits total chars across ALL embeds in one message to 6000
const EMBED_TOTAL_CHAR_LIMIT = 6000;
// If total content exceeds this, send as .md file instead of many embeds
const FILE_FALLBACK_THRESHOLD = EMBED_MAX_DESCRIPTION * 4;

/**
 * Create EmbedBuilder objects that represent the given response split into Discord-safe description chunks.
 *
 * @param content - The full response text to paginate into embed descriptions
 * @returns An array of EmbedBuilder instances, each containing up to 4096 characters of the response; at most 10 embeds are returned, with footers indicating their part number when multiple embeds are produced
 */
function buildResponseEmbeds(content: string): EmbedBuilder[] {
  const chunks = splitDiscordMessage(content, EMBED_MAX_DESCRIPTION);
  const embeds: EmbedBuilder[] = [];

  for (let i = 0; i < chunks.length && i < MAX_EMBEDS_PER_MESSAGE; i++) {
    const embed = new EmbedBuilder()
      .setDescription(chunks[i])
      .setColor(EMBED_COLOR);

    // Only set footer on the last embed if there are multiple
    if (chunks.length > 1 && i === chunks.length - 1) {
      embed.setFooter({ text: `Part ${i + 1} of ${chunks.length}` });
    } else if (chunks.length > 1) {
      embed.setFooter({ text: `Part ${i + 1} of ${chunks.length}` });
    }

    embeds.push(embed);
  }

  return embeds;
}

/**
 * Group embeds into batches where each batch's total character count stays
 * within Discord's 6000-char limit across all embeds in a single message.
 */
function batchEmbedsByCharLimit(embeds: EmbedBuilder[]): EmbedBuilder[][] {
  const batches: EmbedBuilder[][] = [];
  let currentBatch: EmbedBuilder[] = [];
  let currentChars = 0;

  for (const embed of embeds) {
    const embedChars =
      (embed.data.description?.length || 0) +
      (embed.data.footer?.text?.length || 0);

    if (currentBatch.length > 0 && currentChars + embedChars > EMBED_TOTAL_CHAR_LIMIT) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(embed);
    currentChars += embedChars;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Generate an embed representing a thinking/processing state using the current animation frame.
 *
 * @param frameIndex - Index used to select a frame from the thinking animation frames
 * @returns An EmbedBuilder with the thinking color and a description that combines the frame's dots and status text
 */
function buildThinkingEmbed(frameIndex: number): EmbedBuilder {
  const frame = THINKING_FRAMES[frameIndex % THINKING_FRAMES.length];
  return new EmbedBuilder()
    .setColor(THINKING_COLOR)
    .setDescription(`**${frame.dots}** ${frame.text}`);
}

function buildToolEmbed(
  spinnerIndex: number,
  toolName: string,
  action: string,
  detail: string | undefined,
  contentLength: number,
  lineCount: number,
): EmbedBuilder {
  const icon = getToolIcon(toolName);
  const frame = getSpinnerFrame(spinnerIndex);
  const embed = new EmbedBuilder()
    .setColor(TOOL_COLOR)
    .setDescription(`${frame} ${icon} **${action}** ${detail || ''}`);
  if (contentLength > 0) {
    embed.setFooter({ text: `${contentLength.toLocaleString()} chars | ${lineCount} lines` });
  }
  return embed;
}

export class DiscordMessageSender {
  private streamStates: Map<string, DiscordStreamState> = new Map();

  isStreaming(channelId: string): boolean {
    return this.streamStates.has(channelId);
  }

  registerDeferredInteraction(interaction: ChatInputCommandInteraction, channelId: string): void {
    const state: DiscordStreamState = {
      channelId,
      message: null,
      interaction,
      content: '',
      lastUpdate: Date.now(),
      updateScheduled: false,
      spinnerIndex: 0,
      spinnerInterval: null,
      currentOperation: null,
      finished: false,
      editLock: Promise.resolve(),
    };
    state.spinnerInterval = this.startSpinnerAnimation(channelId, state);
    this.streamStates.set(channelId, state);
  }

  async startStreaming(interaction: ChatInputCommandInteraction, channelId: string): Promise<void> {
    await interaction.deferReply();

    const state: DiscordStreamState = {
      channelId,
      message: null,
      interaction,
      content: '',
      lastUpdate: Date.now(),
      updateScheduled: false,
      spinnerIndex: 0,
      spinnerInterval: null,
      currentOperation: null,
      finished: false,
      editLock: Promise.resolve(),
    };

    state.spinnerInterval = this.startSpinnerAnimation(channelId, state);
    this.streamStates.set(channelId, state);
  }

  async startStreamingFromMessage(message: Message, channelId: string): Promise<void> {
    const thinkingMsg = await message.reply({ embeds: [buildThinkingEmbed(0)] });

    const state: DiscordStreamState = {
      channelId,
      message: thinkingMsg,
      interaction: null,
      content: '',
      lastUpdate: Date.now(),
      updateScheduled: false,
      spinnerIndex: 0,
      spinnerInterval: null,
      currentOperation: null,
      finished: false,
      editLock: Promise.resolve(),
    };

    state.spinnerInterval = this.startSpinnerAnimation(channelId, state);
    this.streamStates.set(channelId, state);
  }

  async startStreamingFromExistingMessage(message: Message, channelId: string): Promise<void> {
    const state: DiscordStreamState = {
      channelId,
      message,
      interaction: null,
      content: '',
      lastUpdate: Date.now(),
      updateScheduled: false,
      spinnerIndex: 0,
      spinnerInterval: null,
      currentOperation: null,
      finished: false,
      editLock: Promise.resolve(),
    };

    state.spinnerInterval = this.startSpinnerAnimation(channelId, state);
    this.streamStates.set(channelId, state);
  }

  async startStreamingInChannel(channel: TextBasedChannel & { send: (...args: any[]) => Promise<Message> }, channelId: string): Promise<void> {
    const thinkingMsg = await channel.send({ embeds: [buildThinkingEmbed(0)] });

    const state: DiscordStreamState = {
      channelId,
      message: thinkingMsg,
      interaction: null,
      content: '',
      lastUpdate: Date.now(),
      updateScheduled: false,
      spinnerIndex: 0,
      spinnerInterval: null,
      currentOperation: null,
      finished: false,
      editLock: Promise.resolve(),
    };

    state.spinnerInterval = this.startSpinnerAnimation(channelId, state);
    this.streamStates.set(channelId, state);
  }

  private startSpinnerAnimation(channelId: string, state: DiscordStreamState): NodeJS.Timeout {
    const interval = setInterval(() => {
      const currentState = this.streamStates.get(channelId);
      if (!currentState || currentState !== state) {
        clearInterval(interval);
        return;
      }

      state.spinnerIndex++;
      this.flushUpdate(state).catch(() => {});
    }, SPINNER_INTERVAL_MS);
    interval.unref();
    return interval;
  }

  private stopSpinner(state: DiscordStreamState): void {
    if (state.spinnerInterval) {
      clearInterval(state.spinnerInterval);
      state.spinnerInterval = null;
    }
  }

  updateToolOperation(channelId: string, toolName: string, input?: Record<string, unknown>): void {
    const state = this.streamStates.get(channelId);
    if (!state) return;

    const detail = input ? extractToolDetail(toolName, input) : undefined;
    state.currentOperation = { name: toolName, detail };

    void this.flushUpdate(state);

    const client = getDiscordClient();
    if (client?.user) {
      const action = this.getToolAction(toolName);
      const presenceDetail = input ? extractToolDetail(toolName, input) : '';
      client.user.setActivity(`${action} ${presenceDetail || ''}`.trim(), { type: ActivityType.Custom });
    }
  }

  clearToolOperation(channelId: string): void {
    const state = this.streamStates.get(channelId);
    if (!state) return;
    state.currentOperation = null;

    const client = getDiscordClient();
    if (client?.user) {
      client.user.setActivity('Ready', { type: ActivityType.Custom });
    }
  }

  async updateStream(channelId: string, content: string): Promise<void> {
    const state = this.streamStates.get(channelId);
    if (!state) return;

    state.content = content;

    if (state.updateScheduled) return;

    const timeSinceLastUpdate = Date.now() - state.lastUpdate;
    const debounce = discordConfig.DISCORD_STREAMING_DEBOUNCE_MS;

    if (timeSinceLastUpdate >= debounce) {
      await this.flushUpdate(state);
    } else {
      state.updateScheduled = true;
      const delay = debounce - timeSinceLastUpdate;
      setTimeout(async () => {
        state.updateScheduled = false;
        await this.flushUpdate(state);
      }, delay);
    }
  }

  private async flushUpdate(state: DiscordStreamState): Promise<void> {
    const currentState = this.streamStates.get(state.channelId);
    if (!currentState || currentState !== state) return;
    if (state.finished) return;

    const maxLen = discordConfig.DISCORD_MAX_MESSAGE_LENGTH - 200;
    let content: string | undefined;
    let embed: EmbedBuilder | undefined;

    if (state.currentOperation) {
      const action = this.getToolAction(state.currentOperation.name);
      const detail = state.currentOperation.detail || undefined;
      const lines = state.content ? state.content.split('\n').length : 0;
      embed = buildToolEmbed(
        state.spinnerIndex,
        state.currentOperation.name,
        action,
        detail,
        state.content.length,
        lines,
      );
    } else if (state.content) {
      if (state.content.length <= maxLen) {
        content = state.content;
      } else {
        const tail = state.content.slice(-maxLen);
        const clean = tail.slice(tail.indexOf('\n') + 1);
        content = `*... (${state.content.length.toLocaleString()} chars)*\n${clean}`;
      }
    } else {
      embed = buildThinkingEmbed(state.spinnerIndex);
    }

    state.editLock = state.editLock.then(async () => {
      if (state.finished) return;
      try {
        const payload = embed
          ? { content: '', embeds: [embed] }
          : { content: content || '', embeds: [] };

        if (state.interaction) {
          await state.interaction.editReply(payload);
        } else if (state.message) {
          await state.message.edit(payload);
        }
        state.lastUpdate = Date.now();
      } catch (error: unknown) {
        if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          if (!msg.includes('unknown message') && !msg.includes('missing access')) {
            console.error('[Discord] Error updating stream:', error.message);
          }
        }
      }
    });
    await state.editLock;
  }

  private getToolAction(toolName: string): string {
    const actions: Record<string, string> = {
      Read: 'Reading',
      Write: 'Writing',
      Edit: 'Editing',
      Bash: 'Running',
      Grep: 'Searching',
      Glob: 'Finding files',
      Task: 'Running task',
      WebFetch: 'Fetching',
      WebSearch: 'Searching web',
      NotebookEdit: 'Editing notebook',
      ftree: 'Scanning tree',
      fsearch: 'Searching files',
      fcontent: 'Searching content',
      fmap: 'Mapping code',
      fmetrics: 'Checking metrics',
      read_file: 'Reading',
      read: 'Reading',
      shell: 'Running command',
      exec: 'Executing',
      write: 'Writing file',
      edit: 'Editing file',
      apply_patch: 'Patching',
      remember: 'Remembering',
      recall: 'Recalling',
      forget: 'Forgetting',
      get_context: 'Loading context',
      start_session: 'Starting session',
      end_session: 'Ending session',
      consolidate: 'Consolidating',
      memory_stats: 'Checking stats',
      get_memory: 'Reading memory',
      export_memories: 'Exporting memories',
      import_memories: 'Importing memories',
      get_related: 'Finding related',
      link_memories: 'Linking',
      set_project: 'Setting project',
      get_project: 'Getting project',
      detect_contradictions: 'Detecting conflicts',
      graph_query: 'Querying graph',
      graph_entities: 'Listing entities',
      graph_explain: 'Explaining',
      audit_query: 'Querying audit',
      quarantine_review: 'Reviewing quarantine',
      defence_stats: 'Checking defences',
      scan_memories: 'Scanning memories',
      browser_navigate: 'Navigating',
      browser_snapshot: 'Taking snapshot',
      browser_click: 'Clicking',
      browser_type: 'Typing',
      browser_take_screenshot: 'Screenshotting',
      browser_close: 'Closing browser',
      browser_evaluate: 'Evaluating JS',
      browser_fill_form: 'Filling form',
      browser_hover: 'Hovering',
      browser_select_option: 'Selecting option',
      browser_wait_for: 'Waiting',
      browser_tabs: 'Managing tabs',
    };
    return actions[toolName] || toolName;
  }

  async finishStreaming(channelId: string, finalContent: string): Promise<void> {
    const state = this.streamStates.get(channelId);
    if (!state) return;

    state.finished = true;
    this.streamStates.delete(channelId);

    this.stopSpinner(state);
    state.currentOperation = null;

    await state.editLock;

    const client = getDiscordClient();
    if (client?.user) {
      client.user.setActivity('Ready', { type: ActivityType.Custom });
    }

    const processed = injectAnsiEscapes(finalContent);

    try {
      if (processed.length <= PLAIN_TEXT_THRESHOLD) {
        await this.sendAsPlainText(state, processed);
      } else {
        await this.sendAsPlainTextChunked(state, processed);
      }
    } catch (error) {
      console.error('[Discord] Error finishing stream:', error);
      try {
        const fallbackParts = splitDiscordMessage(finalContent, discordConfig.DISCORD_MAX_MESSAGE_LENGTH);
        if (state.interaction) {
          await state.interaction.editReply(fallbackParts[0] || 'Done.');
          for (let i = 1; i < fallbackParts.length; i++) {
            await state.interaction.followUp(fallbackParts[i]);
          }
        } else if (state.message) {
          await state.message.edit(fallbackParts[0] || 'Done.');
          const chan = state.message.channel;
          if ('send' in chan) {
            for (let i = 1; i < fallbackParts.length; i++) {
              await chan.send(fallbackParts[i]);
            }
          }
        }
      } catch {
        // Give up silently
      }
    }
  }

  private async sendAsPlainText(state: DiscordStreamState, content: string): Promise<void> {
    if (state.interaction) {
      await state.interaction.editReply({ content, embeds: [] });
    } else if (state.message) {
      await state.message.edit({ content, embeds: [] });
    }
  }

  private async sendAsPlainTextChunked(state: DiscordStreamState, content: string): Promise<void> {
    const parts = splitDiscordMessage(content, discordConfig.DISCORD_MAX_MESSAGE_LENGTH);
    const first = parts[0] || 'Done.';
    if (state.interaction) {
      await state.interaction.editReply({ content: first, embeds: [] });
      for (let i = 1; i < parts.length; i++) {
        await state.interaction.followUp({ content: parts[i] });
      }
    } else if (state.message) {
      await state.message.edit({ content: first, embeds: [] });
      const chan = state.message.channel;
      if ('send' in chan) {
        for (let i = 1; i < parts.length; i++) {
          await chan.send({ content: parts[i] });
        }
      }
    }
  }

  // NOTE: These are retained for compatibility but are no longer preferred in finishStreaming.
  private async sendAsEmbeds(state: DiscordStreamState, content: string): Promise<void> {
    const embeds = buildResponseEmbeds(content);
    const batches = batchEmbedsByCharLimit(embeds);

    if (state.interaction) {
      await state.interaction.editReply({ content: '', embeds: batches[0] || [] });
      for (let i = 1; i < batches.length; i++) {
        await state.interaction.followUp({ embeds: batches[i] });
      }
    } else if (state.message) {
      await state.message.edit({ content: '', embeds: batches[0] || [] });
      const chan = state.message.channel;
      if ('send' in chan) {
        for (let i = 1; i < batches.length; i++) {
          await chan.send({ embeds: batches[i] });
        }
      }
    }
  }

  private async sendAsFile(state: DiscordStreamState, content: string): Promise<void> {
    const fileBuffer = Buffer.from(content, 'utf-8');
    const attachment = new AttachmentBuilder(fileBuffer, { name: 'response.md' });

    const previewLength = 300;
    const preview = content.length > previewLength
      ? content.substring(0, previewLength).replace(/[`]/g, '') + '...'
      : content;

    const summaryEmbed = new EmbedBuilder()
      .setDescription(preview)
      .setColor(EMBED_COLOR)
      .setFooter({ text: `Full response: ${content.length.toLocaleString()} chars — see attached .md file` });

    if (state.interaction) {
      await state.interaction.editReply({
        content: '',
        embeds: [summaryEmbed],
        files: [attachment],
      });
    } else if (state.message) {
      await state.message.edit({ content: '', embeds: [summaryEmbed] });
      const chan = state.message.channel;
      if ('send' in chan) {
        await chan.send({ files: [attachment] });
      }
    }
  }

  async cancelStreaming(channelId: string): Promise<void> {
    const state = this.streamStates.get(channelId);
    if (!state) return;

    state.finished = true;
    this.streamStates.delete(channelId);

    this.stopSpinner(state);

    await state.editLock;

    const client = getDiscordClient();
    if (client?.user) {
      client.user.setActivity('Ready', { type: ActivityType.Custom });
    }

    try {
      const cancelled = new EmbedBuilder()
        .setColor(0xED4245)
        .setDescription('Request cancelled.');

      if (state.interaction) {
        await state.interaction.editReply({ embeds: [cancelled], content: '' });
      } else if (state.message) {
        await state.message.edit({ embeds: [cancelled], content: '' });
      }
    } catch {
      // ignore
    }
  }

  async sendTyping(channelId: string): Promise<void> {
    const client = getDiscordClient();
    if (!client) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && 'sendTyping' in channel) {
      await (channel as any).sendTyping();
    }
  }

  async sendStatusLine(channelId: string, status: string): Promise<void> {
    const content = status;
    const client = getDiscordClient();
    if (!client) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && 'send' in channel) {
      await (channel as any).send({ content });
    }
  }

  async sendToolList(channelId: string): Promise<void> {
    const tools = Object.entries(TOOL_ICONS)
      .map(([name, icon]) => `${icon} ${name}`)
      .join('\n');

    const client = getDiscordClient();
    if (!client) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && 'send' in channel) {
      await (channel as any).send({ content: `Available tools:\n${tools}` });
    }
  }
}

export const discordMessageSender = new DiscordMessageSender();
