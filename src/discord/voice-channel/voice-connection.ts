import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState,
  EndBehaviorType,
  type VoiceConnection,
  type AudioPlayer,
  type AudioReceiveStream,
} from '@discordjs/voice';
import type { VoiceBasedChannel } from 'discord.js';
import { createRequire } from 'node:module';
import { createPlaybackResampler, createReceiveResampler, type Resampler, type ReceiveResampler } from './audio-pipeline.js';
import { createGeminiLiveSession, type GeminiLiveSession } from './gemini-live.js';
import { voiceTools } from './voice-tools.js';
import { createDiscordVoiceTools } from './discord-voice-tools.js';
import { createAgentVoiceTools, agentContextFromGuild } from './agent-voice-tools.js';
import { getDiscordClient } from '../discord-bot.js';
import { eventBus } from '../../dashboard/event-bus.js';

// prism-media is CJS-only — use createRequire for ESM compat
const require = createRequire(import.meta.url);
const prism = require('prism-media');

// Pre-warm @snazzah/davey so @discordjs/voice's internal daveLoadPromise
// resolves from the module cache before any voice connection is attempted.
// Without this, there's a race condition where the DAVE protocol check
// throws an uncaught exception because the async import hasn't resolved yet.
let daveyWarmed = false;
/**
 * Preloads the @snazzah/davey DAVE protocol library to avoid race conditions with Discord voice.
 *
 * If the library is not already loaded, imports it, yields briefly to allow Discord voice internals
 * to settle, marks the library as warmed, and logs success; logs a warning on failure.
 */
async function warmDavey(): Promise<void> {
  if (daveyWarmed) return;
  try {
    await import('@snazzah/davey');
    // Yield to let @discordjs/voice's internal daveLoadPromise microtask resolve
    await new Promise(resolve => setTimeout(resolve, 100));
    daveyWarmed = true;
    console.log('[Voice] DAVE protocol library pre-loaded');
  } catch (err) {
    console.warn('[Voice] Failed to pre-load @snazzah/davey:', err);
  }
}

// ── Per-guild voice session state ────────────────────────────────────

export interface VoiceSessionState {
  connection: VoiceConnection;
  player: AudioPlayer;
  gemini: GeminiLiveSession;
  playbackResampler: Resampler;
  receiveResamplers: Map<string, ReceiveResampler>;
  subscriptions: Map<string, AudioReceiveStream>;
  guildId: string;
  channelId: string;
  textChannelId?: string;
  onTextMessage?: (text: string) => void;
  endDebounceTimer?: ReturnType<typeof setTimeout>;
}

/** Mutable playback context shared across Gemini session reconnections. */
interface PlaybackCtx {
  resampler: Resampler;
  audioChunks: number;
}

const sessions = new Map<string, VoiceSessionState>();

// ── Gemini reconnect bookkeeping ─────────────────────────────────────

const MAX_RECONNECTS = 3;
const RECONNECT_DELAY_MS = 2000;
const reconnectAttempts = new Map<string, number>();

/**
 * Retrieve the active voice session state for a given guild.
 *
 * @param guildId - The guild's ID
 * @returns The `VoiceSessionState` for `guildId` if a session exists, `undefined` otherwise
 */

export function getVoiceSession(guildId: string): VoiceSessionState | undefined {
  return sessions.get(guildId);
}

/**
 * Checks whether there is an active voice session for the given guild.
 *
 * @param guildId - The Discord guild (server) identifier to check
 * @returns `true` if an active session exists for the guild, `false` otherwise
 */
export function isInVoiceChannel(guildId: string): boolean {
  return sessions.has(guildId);
}

/**
 * Joins the given Discord voice channel, starts the playback and receive audio pipelines, and establishes a Gemini Live session for that guild.
 *
 * @param channel - The Discord voice channel to join.
 * @param opts - Optional parameters.
 * @param opts.textChannelId - ID of a text channel to associate with the session.
 * @param opts.onTextMessage - Callback invoked when the Gemini session emits text messages for the session.
 * @returns The active VoiceSessionState for the guild.
 */
export async function joinAndConnect(
  channel: VoiceBasedChannel,
  opts?: {
    textChannelId?: string;
    onTextMessage?: (text: string) => void;
  },
): Promise<VoiceSessionState> {
  const guildId = channel.guild.id;

  // If already in this channel, return existing session
  const existing = sessions.get(guildId);
  if (existing && existing.channelId === channel.id && existing.gemini.isOpen) {
    return existing;
  }

  // If in a different channel, disconnect first
  if (existing) {
    await disconnect(guildId);
  }

  // 0) Pre-warm DAVE protocol library (prevents race condition crash)
  await warmDavey();

  // 1) Join Discord voice channel
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });

  connection.subscribe(player);

  // 2) Playback pipeline: Gemini PCM 24k mono → ffmpeg → Discord PCM 48k stereo
  const ctx: PlaybackCtx = {
    resampler: createPlaybackResampler(),
    audioChunks: 0,
  };
  let resource = createAudioResource(ctx.resampler.output, { inputType: StreamType.Raw });
  player.play(resource);

  // 3) Connect to Gemini Live
  const gemini = await connectGeminiSession(guildId, player, ctx, {
    channelId: channel.id,
    textChannelId: opts?.textChannelId,
  });

  const state: VoiceSessionState = {
    connection,
    player,
    gemini,
    playbackResampler: ctx.resampler,
    receiveResamplers: new Map(),
    subscriptions: new Map(),
    guildId,
    channelId: channel.id,
    textChannelId: opts?.textChannelId,
    onTextMessage: opts?.onTextMessage,
  };

  sessions.set(guildId, state);
  reconnectAttempts.delete(guildId);

  // 4) Subscribe to incoming audio from voice channel users.
  //    We use Discord's speaking events to drive manual VAD (activityStart/End)
  //    so Gemini gets clean speech boundaries without its own VAD fighting us.
  //    activityEnd is debounced because Discord fires rapid end→start pairs for
  //    micro-pauses mid-sentence, which cause false barge-ins that kill responses.
  const speakingUsers = new Set<string>();
  let activityActive = false;
  const ACTIVITY_END_DEBOUNCE_MS = 300;

  connection.receiver.speaking.on('start', (userId) => {
    const currentState = sessions.get(guildId);
    if (!currentState || currentState !== state) return;
    subscribeToUser(currentState, userId);

    // Cancel any pending activityEnd — user resumed speaking
    if (state.endDebounceTimer) {
      clearTimeout(state.endDebounceTimer);
      state.endDebounceTimer = undefined;
    }

    speakingUsers.add(userId);
    if (!activityActive && currentState.gemini.isOpen) {
      // Look up the speaker's display name
      const guild = channel.guild;
      const member = guild.members.cache.get(userId);
      const speakerName = member?.displayName ?? member?.user.username;

      console.log(`[Voice] activityStart (user ${userId} / ${speakerName ?? 'unknown'} began speaking)`);
      currentState.gemini.sendActivityStart(speakerName);
      activityActive = true;
    }
  });

  connection.receiver.speaking.on('end', (userId) => {
    const currentState = sessions.get(guildId);
    if (!currentState || currentState !== state) return;

    speakingUsers.delete(userId);

    // Debounce: wait before sending activityEnd so micro-pauses in speech
    // don't trigger false barge-ins while Gemini is responding.
    if (speakingUsers.size === 0 && activityActive) {
      if (state.endDebounceTimer) clearTimeout(state.endDebounceTimer);
      state.endDebounceTimer = setTimeout(() => {
        state.endDebounceTimer = undefined;
        if (speakingUsers.size === 0 && activityActive) {
          console.log(`[Voice] activityEnd (user ${userId} stopped speaking)`);
          if (currentState.gemini.isOpen) {
            currentState.gemini.sendActivityEnd();
          }
          activityActive = false;
        }
      }, ACTIVITY_END_DEBOUNCE_MS);
    }
  });

  // Handle disconnection — clean up immediately when the bot is kicked or
  // the connection drops, instead of trying to auto-recover (which caused
  // the bot to rejoin after being removed from the channel).
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    disconnect(guildId).catch((err) => {
      console.error(`[Voice] Error during disconnect cleanup for guild ${guildId}:`, err);
    });
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    cleanupSession(guildId);
  });

  return state;
}

/**
 * Send a text prompt to the guild's open Gemini Live session.
 *
 * If there is no active or open Gemini session for the guild, the prompt is not sent.
 *
 * @param guildId - The Discord guild (server) ID to target
 * @param text - The text prompt to deliver to Gemini Live
 * @returns `true` if the prompt was sent to an open Gemini session, `false` otherwise
 */
export function sendTextToGemini(guildId: string, text: string): boolean {
  const state = sessions.get(guildId);
  if (!state || !state.gemini.isOpen) return false;
  state.gemini.sendText(text);
  return true;
}

/**
 * Tear down and disconnect the voice session for a guild, closing its Gemini session.
 *
 * @param guildId - The Discord guild ID whose voice session should be disconnected
 */
export async function disconnect(guildId: string): Promise<void> {
  const state = sessions.get(guildId);
  if (!state) return;

  reconnectAttempts.delete(guildId);
  cleanupSession(guildId);

  try {
    state.connection.destroy();
  } catch { /* already destroyed */ }
}

/**
 * Disconnects all active voice sessions and waits for each to finish disconnecting.
 */
export async function disconnectAll(): Promise<void> {
  const guildIds = [...sessions.keys()];
  console.log(`[Voice] Disconnecting ${guildIds.length} active session(s)...`);
  await Promise.all(guildIds.map((guildId) => disconnect(guildId)));
}

/**
 * Create and configure a Gemini Live session wired to the guild's playback and receive pipelines.
 *
 * Builds a composite toolset (voice, Discord, and agent tools), attaches real-time callbacks for incoming
 * audio, interruptions, turn completion, lifecycle events, and text messages, and returns the configured session.
 *
 * @param ctx - Playback context containing the resampler and audio chunk counter used to feed Discord playback
 * @param voiceCtx - Optional initial voice context containing channelId and optional textChannelId; used when called before the session state is populated
 * @returns The configured GeminiLiveSession for the specified guild
 */

async function connectGeminiSession(
  guildId: string,
  player: AudioPlayer,
  ctx: PlaybackCtx,
  voiceCtx?: { channelId: string; textChannelId?: string },
): Promise<GeminiLiveSession> {
  // Build Discord-aware tools if we have client + channel context.
  // voiceCtx is passed directly on initial connect (before sessions map is populated)
  // and derived from the sessions map on reconnect.
  const state = sessions.get(guildId);
  const channelId = voiceCtx?.channelId ?? state?.channelId;
  const textChannelId = voiceCtx?.textChannelId ?? state?.textChannelId;
  const client = getDiscordClient();

  console.log(`[Voice] Building tools — client=${!!client}, channelId=${channelId}, textChannelId=${textChannelId}`);

  const discordTools = (client && channelId)
    ? createDiscordVoiceTools({
        client,
        guildId,
        channelId,
        textChannelId,
      })
    : [];
  const agentTools = createAgentVoiceTools(agentContextFromGuild(guildId));
  const allTools = [...voiceTools, ...discordTools, ...agentTools];

  console.log(`[Voice] Tools registered: ${allTools.map(t => t.name).join(', ')} (${allTools.length} total)`);

  return createGeminiLiveSession({
    onAudio: (pcmBuffer) => {
      // If the player went Idle (stream drained between turns) or the
      // resampler ffmpeg died, reset the playback pipeline so new audio
      // actually reaches Discord.
      if (player.state.status === AudioPlayerStatus.Idle || !ctx.resampler.alive) {
        console.log(`[Voice] Playback pipeline stale (player=${player.state.status}, alive=${ctx.resampler.alive}) — resetting`);
        ctx.resampler.kill();
        ctx.audioChunks = 0;
        ctx.resampler = createPlaybackResampler();
        const res = createAudioResource(ctx.resampler.output, { inputType: StreamType.Raw });
        player.play(res);
        const st = sessions.get(guildId);
        if (st) st.playbackResampler = ctx.resampler;
      }

      ctx.audioChunks++;
      if (ctx.audioChunks === 1 || ctx.audioChunks % 50 === 0) {
        console.log(`[Voice] Audio chunk #${ctx.audioChunks} (${pcmBuffer.length} bytes) → resampler`);
      }
      // Write without backpressure handling — for real-time audio we
      // prioritise latency.  The old `.once('drain')` pattern leaked
      // listeners (MaxListenersExceededWarning).
      const ok = ctx.resampler.input.write(pcmBuffer);
      if (!ok && ctx.audioChunks % 100 === 0) {
        console.warn(`[Voice] Playback resampler backpressure at chunk #${ctx.audioChunks}`);
      }
    },

    onInterrupted: () => {
      console.log('[Voice] Barge-in — resetting playback pipeline');
      eventBus.emit('voice:interrupted', { guildId, timestamp: Date.now() });
      ctx.resampler.kill();
      ctx.audioChunks = 0;
      ctx.resampler = createPlaybackResampler();
      const res = createAudioResource(ctx.resampler.output, { inputType: StreamType.Raw });
      player.play(res);
      const st = sessions.get(guildId);
      if (st) st.playbackResampler = ctx.resampler;
    },

    onTurnComplete: () => {
      console.log(`[Voice] Gemini turn complete (${ctx.audioChunks} audio chunks played)`);
      ctx.audioChunks = 0;
    },

    onOpen: () => {
      console.log(`[Voice] Gemini Live connected (guild ${guildId})`);
      eventBus.emit('voice:open', { guildId, channelId: channelId || '', timestamp: Date.now() });
      // Delay clearing the reconnect counter — if the session closes within
      // seconds of opening (unstable), the counter keeps incrementing so we
      // eventually hit MAX_RECONNECTS and stop instead of looping forever.
      setTimeout(() => {
        if (sessions.has(guildId)) {
          reconnectAttempts.delete(guildId);
        }
      }, 30_000);
    },

    onError: (err) => {
      console.error(`[Voice] Gemini Live error (guild ${guildId}):`, err.message);
    },

    onClose: (reason) => {
      console.log(`[Voice] Gemini Live closed (guild ${guildId}): ${reason}`);
      eventBus.emit('voice:close', { guildId, reason, timestamp: Date.now() });
      // Auto-reconnect if the session still exists (user didn't /voice leave)
      attemptGeminiReconnect(guildId, player, ctx);
    },

    onText: (text) => {
      eventBus.emit('voice:text', { guildId, text, timestamp: Date.now() });
      const st = sessions.get(guildId);
      st?.onTextMessage?.(text);
    },
  }, allTools, guildId);
}

/**
 * Attempts to re-establish the Gemini Live session for a guild, with a bounded linear backoff and retry limit.
 *
 * If a session exists for the given guild, this function will try to reconnect Gemini, reset the playback pipeline to a clean state, and replace the session's Gemini instance when successful. If the maximum number of reconnect attempts is exceeded, it notifies the guild via the session's `onTextMessage` handler and stops retrying. The operation is no-op if the guild session is torn down during the process.
 *
 * @param guildId - The guild identifier whose Gemini session should be reconnected
 * @param player - The audio player associated with the guild's voice session; used to replay the playback resampler output
 * @param ctx - The playback context containing the current resampler and audio chunk counter; the resampler will be reset when reconnecting
 */

async function attemptGeminiReconnect(
  guildId: string,
  player: AudioPlayer,
  ctx: PlaybackCtx,
): Promise<void> {
  const state = sessions.get(guildId);
  if (!state) return; // session fully torn down — user /voice leave'd

  const attempts = (reconnectAttempts.get(guildId) ?? 0) + 1;
  if (attempts > MAX_RECONNECTS) {
    console.error(`[Voice] Max Gemini reconnects (${MAX_RECONNECTS}) reached — giving up`);
    state.onTextMessage?.('⚠️ Gemini session lost after multiple retries. Use `/voice leave` then `/voice join` to reconnect.');
    reconnectAttempts.delete(guildId);
    return;
  }

  reconnectAttempts.set(guildId, attempts);
  const delay = RECONNECT_DELAY_MS * attempts; // linear backoff
  console.log(`[Voice] Reconnecting Gemini (attempt ${attempts}/${MAX_RECONNECTS}) in ${delay}ms…`);

  await new Promise(resolve => setTimeout(resolve, delay));

  // Re-check — user might have /voice leave'd during the delay
  if (!sessions.has(guildId)) {
    reconnectAttempts.delete(guildId);
    return;
  }

  try {
    // Reset playback pipeline for a clean slate
    ctx.resampler.kill();
    ctx.audioChunks = 0;
    ctx.resampler = createPlaybackResampler();
    const res = createAudioResource(ctx.resampler.output, { inputType: StreamType.Raw });
    player.play(res);
    state.playbackResampler = ctx.resampler;

    const newGemini = await connectGeminiSession(guildId, player, ctx);

    // Re-check after the async connect — the user might have /voice leave'd
    // while we were connecting, which would leave an orphan Gemini session.
    if (!sessions.has(guildId)) {
      newGemini.close();
      return;
    }

    state.gemini = newGemini;
  } catch (err: any) {
    console.error(`[Voice] Gemini reconnect attempt ${attempts} failed:`, err.message);
    // connectGeminiSession threw before onClose could fire — explicitly retry
    if (sessions.has(guildId) && attempts < MAX_RECONNECTS) {
      attemptGeminiReconnect(guildId, player, ctx);
    }
  }
}

/**
 * Subscribe to a user's Discord Opus voice stream, decode it to 48 kHz stereo PCM, and forward audio chunks to the session's Gemini Live connection.
 *
 * This creates (or reuses) a per-user Opus subscription and a persistent receive resampler. The resampler is kept alive across subscription cycles so ffmpeg is not respawned on every reconnect; decoded PCM is written into the resampler and sent to Gemini while the session is open.
 *
 * @param state - The guild's VoiceSessionState containing the voice connection, Gemini session, and resampler/subscription maps
 * @param userId - The Discord user ID whose audio should be subscribed to and forwarded
 */

function subscribeToUser(state: VoiceSessionState, userId: string): void {
  // If the existing opus subscription is still healthy, nothing to do
  const existing = state.subscriptions.get(userId);
  if (existing && !existing.destroyed && existing.readable) return;

  // Clean up dead opus stream (but keep the resampler alive — it's persistent)
  if (existing) {
    state.subscriptions.delete(userId);
    try { existing.destroy(); } catch { /* ignore */ }
  }

  console.log(`[Voice] Subscribing to user audio: ${userId}`);

  const opusStream = state.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.Manual },
  });

  state.subscriptions.set(userId, opusStream);

  // Opus → PCM 48k stereo via prism-media decoder (new each subscription cycle)
  const decoder = new prism.opus.Decoder({
    rate: 48000,
    channels: 2,
    frameSize: 960,
  });

  // Get or create a persistent receive resampler for this user.
  // The resampler (ffmpeg process) survives opus stream death so we
  // don't spawn a new ffmpeg every time Discord re-subscribes.
  let recvResampler = state.receiveResamplers.get(userId);
  if (!recvResampler || !recvResampler.alive) {
    if (recvResampler) recvResampler.kill();
    recvResampler = createReceiveResampler();
    state.receiveResamplers.set(userId, recvResampler);

    // Attach the data handler once per resampler lifetime
    let userChunks = 0;
    recvResampler.output.on('data', (chunk: Buffer) => {
      if (state.gemini.isOpen) {
        userChunks++;
        if (userChunks === 1 || userChunks % 100 === 0) {
          console.log(`[Voice] User ${userId} audio chunk #${userChunks} (${chunk.length} bytes) → Gemini`);
        }
        state.gemini.sendAudio(chunk);
      }
    });
  }

  // When the opus stream dies, just remove the subscription entry.
  // The resampler stays alive for the next subscription cycle.
  const onStreamDeath = () => {
    state.subscriptions.delete(userId);
    try { decoder.destroy(); } catch { /* ignore */ }
  };

  // Pipe opus→decoder normally (decoder dies with the stream — that's fine).
  // Use { end: false } on decoder→resampler so the ffmpeg resampler survives.
  opusStream.pipe(decoder);
  decoder.on('error', (err: Error) => {
    console.error(`[Voice] Opus decoder error for ${userId}:`, err.message);
    onStreamDeath();
  });
  decoder.pipe(recvResampler.input, { end: false });

  opusStream.on('close', onStreamDeath);
  opusStream.on('error', (err: Error) => {
    console.error(`[Voice] Opus stream error for ${userId}:`, err.message);
    onStreamDeath();
  });
}

/**
 * Tears down and removes the voice session for the given guild.
 *
 * If no session exists for the guild, this is a no-op. For an existing session it:
 * closes the Gemini session, clears the end-debounce timer, removes the session
 * from the internal map, kills the playback resampler and all per-user receive
 * resamplers, destroys and clears all user subscriptions, stops the audio player,
 * and logs the cleanup.
 */

function cleanupSession(guildId: string): void {
  const state = sessions.get(guildId);
  if (!state) return;

  // Clear debounce timer to prevent it firing after cleanup
  if (state.endDebounceTimer) {
    clearTimeout(state.endDebounceTimer);
    state.endDebounceTimer = undefined;
  }

  // Remove from the map FIRST — if gemini.close() triggers an onClose
  // callback synchronously, attemptGeminiReconnect will check the map
  // and bail out because the session is already gone.
  sessions.delete(guildId);

  state.gemini.close();
  state.playbackResampler.kill();

  for (const [, resampler] of state.receiveResamplers) {
    resampler.kill();
  }
  state.receiveResamplers.clear();

  for (const [, stream] of state.subscriptions) {
    try { stream.destroy(); } catch { /* ignore */ }
  }
  state.subscriptions.clear();

  state.player.stop(true);
  console.log(`[Voice] Cleaned up session for guild ${guildId}`);
}