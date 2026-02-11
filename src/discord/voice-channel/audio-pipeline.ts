import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { resolveBin } from '../../utils/resolve-bin.js';

/**
 * Resampler: Gemini PCM (24kHz mono s16le) → Discord PCM (48kHz stereo s16le).
 * Uses ffmpeg as a subprocess for sample-rate conversion and channel upmix.
 */
export interface Resampler {
  /** Write Gemini's 24k mono PCM here. */
  input: PassThrough;
  /** Read 48k stereo PCM from here (feed to Discord). */
  output: PassThrough;
  /** Kill the ffmpeg process. */
  kill: () => void;
  /** True if the ffmpeg process is still alive. */
  alive: boolean;
}

/**
 * Create a resampler that converts 24 kHz mono s16le PCM (Gemini) to 48 kHz stereo s16le PCM (Discord) using an ffmpeg subprocess.
 *
 * The returned object exposes input and output PassThrough streams for piping audio, a `kill` function to terminate ffmpeg and clean up streams, and an `alive` getter that reflects whether the ffmpeg process is running. If ffmpeg fails or exits, `alive` becomes `false` and the output stream is ended or destroyed.
 *
 * @returns A Resampler with:
 *  - `input`: PassThrough to receive 24 kHz mono s16le PCM,
 *  - `output`: PassThrough that emits 48 kHz stereo s16le PCM,
 *  - `kill()`: function that forcefully terminates the ffmpeg process and destroys streams,
 *  - `alive`: boolean indicating whether the ffmpeg subprocess is currently alive.
 */
export function createPlaybackResampler(): Resampler {
  const input = new PassThrough();
  const output = new PassThrough();

  const ffmpeg = spawn(resolveBin('ffmpeg'), [
    '-loglevel', 'warning',
    '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
    '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'inherit'] });

  let alive = true;

  ffmpeg.on('error', (err) => {
    console.error('[PlaybackResampler] ffmpeg spawn error:', err.message);
    alive = false;
    output.destroy(err);
  });

  if (!ffmpeg.stdin || !ffmpeg.stdout) {
    alive = false;
    const err = new Error('ffmpeg stdio not available — spawn may have failed');
    output.destroy(err);
    return { input, output, kill: () => { alive = false; }, get alive() { return alive; } };
  }

  input.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(output);

  ffmpeg.on('exit', () => {
    alive = false;
    output.end();
  });

  ffmpeg.stdin.on('error', () => { /* swallow broken pipe */ });

  return {
    input,
    output,
    kill: () => {
      alive = false;
      input.unpipe();
      try { ffmpeg.kill('SIGKILL'); } catch { /* already dead */ }
      input.destroy();
      output.destroy();
    },
    get alive() { return alive; },
  };
}

/**
 * Resampler: Discord PCM (48kHz stereo s16le) → Gemini PCM (16kHz mono s16le).
 * Used for the receive path (user talking → Gemini input).
 */
export interface ReceiveResampler {
  /** Write Discord's 48k stereo PCM here. */
  input: PassThrough;
  /** Read 16k mono PCM from here (send to Gemini). */
  output: PassThrough;
  kill: () => void;
  alive: boolean;
}

/**
 * Create a resampler that converts 48 kHz stereo s16le PCM (Discord) to 16 kHz mono s16le PCM (Gemini).
 *
 * The returned object exposes an `input` stream to receive 48 kHz stereo s16le PCM, an `output` stream that emits 16 kHz mono s16le PCM, a `kill()` function to terminate the underlying ffmpeg process and clean up streams, and an `alive` getter that reflects whether the ffmpeg process is currently running.
 *
 * @returns A ReceiveResampler with:
 * - `input`: a PassThrough to write 48 kHz stereo s16le PCM into the resampler
 * - `output`: a PassThrough that emits 16 kHz mono s16le PCM from the resampler
 * - `kill()`: a function that forcefully stops the resampler and destroys streams
 * - `alive`: a boolean getter indicating whether the underlying ffmpeg process is alive
 */
export function createReceiveResampler(): ReceiveResampler {
  const input = new PassThrough();
  const output = new PassThrough();

  const ffmpeg = spawn(resolveBin('ffmpeg'), [
    '-loglevel', 'warning',
    '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
    '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'inherit'] });

  let alive = true;

  ffmpeg.on('error', (err) => {
    console.error('[ReceiveResampler] ffmpeg spawn error:', err.message);
    alive = false;
    output.destroy(err);
  });

  if (!ffmpeg.stdin || !ffmpeg.stdout) {
    alive = false;
    const err = new Error('ffmpeg stdio not available — spawn may have failed');
    output.destroy(err);
    return { input, output, kill: () => { alive = false; }, get alive() { return alive; } };
  }

  input.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(output);

  ffmpeg.on('exit', () => {
    alive = false;
    output.end();
  });

  ffmpeg.stdin.on('error', () => { /* swallow broken pipe */ });

  return {
    input,
    output,
    kill: () => {
      alive = false;
      input.unpipe();
      try { ffmpeg.kill('SIGKILL'); } catch { /* already dead */ }
      input.destroy();
      output.destroy();
    },
    get alive() { return alive; },
  };
}