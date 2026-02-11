import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';
import { config } from '../config.js';
import { eventBus } from '../dashboard/event-bus.js';

// ── Types ────────────────────────────────────────────────────────────

export interface DroidOptions {
  model?: string;
  auto?: 'low' | 'medium' | 'high';
  cwd?: string;
  sessionId?: string;
  useSpec?: string;
  timeoutMs?: number;
}

export interface DroidResult {
  result: string;
  sessionId?: string;
  durationMs: number;
  isError: boolean;
  numTurns?: number;
}

export interface DroidStreamEvent {
  type: 'system' | 'message' | 'tool_call' | 'tool_result' | 'completion' | 'result' | 'error';
  data: any;
}

/**
 * Expands a leading tilde in a filesystem path to the current user's home directory.
 *
 * @param p - The path string that may start with `~`
 * @returns The input path with a leading `~` replaced by the user's home directory, or the original path if it does not start with `~`
 */

function expandTilde(p: string): string {
  return p.startsWith('~') ? p.replace('~', homedir()) : p;
}

/**
 * Locate the Droid executable on the local system.
 *
 * Checks common install locations and the configured `DROID_EXEC_PATH`; returns the first path that exists.
 *
 * @returns The filesystem path to the Droid executable.
 * @throws Error if no executable is found. 
 */
function resolveDroidBinary(): string {
  // Look for `droid` binary (not the wrapper)
  const candidates = [
    expandTilde('~/.local/bin/droid'),
    '/usr/local/bin/droid',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fallback: try the config path (might point to the wrapper or binary)
  const fromConfig = expandTilde(config.DROID_EXEC_PATH);
  if (existsSync(fromConfig)) return fromConfig;
  throw new Error('droid binary not found. Install Factory Droid or update DROID_EXEC_PATH.');
}

/**
 * Build the command-line arguments for invoking the `droid exec` command.
 *
 * Constructs an argument list that sets the output format, auto level, model, optional session and working directory, and includes the prompt. If `opts.useSpec` points to an existing file, its contents are prepended to the prompt (separated by two newlines).
 *
 * @param prompt - The user prompt to send to the droid process (or appended after spec content when present)
 * @param outputMode - The output format flag (`'json'` or `'stream-json'`) to set via `--output-format`
 * @param opts - Options controlling model selection, auto level, session id, working directory, and optional spec file path
 * @returns The array of CLI arguments to pass to the `droid` executable (suitable for spawn)
 */
function buildArgs(prompt: string, outputMode: 'json' | 'stream-json', opts: DroidOptions): string[] {
  // Call `droid exec` directly (not the wrapper) so we can pass --output-format
  const args: string[] = ['exec'];

  args.push('--output-format', outputMode);
  args.push('--auto', opts.auto ?? 'low');

  if (opts.model) {
    args.push('--model', opts.model);
  } else {
    args.push('--model', config.DROID_DEFAULT_MODEL);
  }

  if (opts.sessionId) {
    args.push('--session-id', opts.sessionId);
  }

  if (opts.cwd) {
    args.push('--cwd', opts.cwd);
  }

  // Spec file: read and prepend to prompt
  if (opts.useSpec) {
    const specPath = expandTilde(opts.useSpec);
    if (existsSync(specPath)) {
      const specContent = readFileSync(specPath, 'utf-8');
      args.push(specContent + '\n\n' + prompt);
    } else {
      args.push(prompt);
    }
  } else {
    args.push(prompt);
  }

  return args;
}

/**
 * Start the Droid executable as a child process with piped stdio and an enforced timeout.
 *
 * @param args - Command-line arguments to pass to the Droid binary
 * @param timeoutMs - Maximum runtime in milliseconds before the process is terminated
 * @returns An object with:
 *  - `proc`: the spawned ChildProcess
 *  - `kill`: a function that clears the internal timeout and attempts to terminate the process (sends `SIGTERM`, then `SIGKILL` if the process remains after ~5 seconds)
 */
function spawnDroid(args: string[], timeoutMs: number): { proc: ChildProcess; kill: () => void } {
  const droidBin = resolveDroidBinary();
  console.log(`[Droid] Spawning: ${droidBin} ${args.slice(0, 4).join(' ')} ... (timeout ${timeoutMs}ms)`);
  const proc = spawn(droidBin, args, {
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timer = setTimeout(() => {
    proc.kill('SIGTERM');
    setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5_000);
  }, timeoutMs);

  const kill = () => {
    clearTimeout(timer);
    if (!proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5_000);
    }
  };

  proc.on('exit', () => clearTimeout(timer));
  proc.on('error', () => clearTimeout(timer));

  return { proc, kill };
}

/**
 * Executes the Droid CLI with the given prompt and returns its single structured result.
 *
 * Executes droid in JSON mode (when supported), collects stdout/stderr, parses JSON output into a DroidResult, and emits lifecycle events (`droid:start`, `droid:complete`). Rejects the promise if the process fails to spawn or if no output is produced.
 *
 * @param prompt - The text prompt to send to the droid executable
 * @param opts - Optional execution settings (model, auto level, cwd, sessionId, useSpec, timeoutMs)
 * @returns A DroidResult containing `result`, optional `sessionId`, `durationMs`, `isError`, and optional `numTurns`
 */

export async function execDroidJSON(prompt: string, opts: DroidOptions = {}): Promise<DroidResult> {
  const timeoutMs = opts.timeoutMs ?? config.DROID_TIMEOUT_MS;
  const droidModel = opts.model ?? config.DROID_DEFAULT_MODEL;
  eventBus.emit('droid:start', { prompt: prompt.slice(0, 200), model: droidModel, timestamp: Date.now() });
  const args = buildArgs(prompt, 'json', opts);
  const { proc, kill } = spawnDroid(args, timeoutMs);

  return new Promise<DroidResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout!.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr!.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', (err) => {
      kill();
      reject(new Error(`Failed to spawn droid-exec: ${err.message}`));
    });

    proc.on('exit', (code) => {
      kill();
      const stdout = Buffer.concat(chunks).toString('utf-8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (stderr) {
        console.error('[Droid] stderr:', stderr.slice(0, 500));
      }

      if (!stdout) {
        reject(new Error(`droid-exec returned empty output (exit code ${code}). ${stderr.slice(0, 300)}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const droidResult = {
          result: parsed.result ?? stdout,
          sessionId: parsed.session_id,
          durationMs: parsed.duration_ms ?? 0,
          isError: parsed.is_error ?? (code !== 0),
          numTurns: parsed.num_turns,
        };
        eventBus.emit('droid:complete', { result: droidResult.result.slice(0, 500), durationMs: droidResult.durationMs, isError: droidResult.isError, timestamp: Date.now() });
        resolve(droidResult);
      } catch {
        // droid-exec might return plain text if -o json isn't supported by version
        const droidResult = {
          result: stdout,
          durationMs: 0,
          isError: code !== 0,
        };
        eventBus.emit('droid:complete', { result: droidResult.result.slice(0, 500), durationMs: 0, isError: droidResult.isError, timestamp: Date.now() });
        resolve(droidResult);
      }
    });
  });
}

// ── Stream mode (JSONL events) ───────────────────────────────────────

export async function* execDroidStream(prompt: string, opts: DroidOptions = {}): AsyncGenerator<DroidStreamEvent> {
  const timeoutMs = opts.timeoutMs ?? config.DROID_TIMEOUT_MS;
  const droidModel = opts.model ?? config.DROID_DEFAULT_MODEL;
  eventBus.emit('droid:start', { prompt: prompt.slice(0, 200), model: droidModel, timestamp: Date.now() });
  const args = buildArgs(prompt, 'stream-json', opts);
  const { proc, kill } = spawnDroid(args, timeoutMs);

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        const type = event.type ?? 'message';
        yield { type, data: event } as DroidStreamEvent;

        // If this is a completion event, we're done
        if (type === 'result' || (type === 'completion')) {
          break;
        }
      } catch {
        // Non-JSON line — treat as plain message
        yield { type: 'message', data: { content: trimmed } };
      }
    }
  } finally {
    kill();
  }
}