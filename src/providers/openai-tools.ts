/**
 * Custom tools for the OpenAI Agents SDK.
 *
 * Provides two tiers:
 *   - Always: fsuite CLI tools (ftree, fsearch, fcontent, fmap, fread, fmetrics) + read_file
 *   - DANGEROUS_MODE only: custom function tools for shell/write/edit/patch
 *
 * fsuite doctrine:
 *   - treat the available fsuite tools as a composable sensor suite, not one sacred path
 *   - use ftree once, intentionally, to establish territory
 *   - start with fsearch to narrow candidate files by path or filename
 *   - use fcontent only for exact-text confirmation after narrowing
 *   - when a wrapper exposes output control, prefer -o paths for piping, -o json for programmatic decisions, pretty for humans
 *   - fmap is the bridge in the middle; fmap + fread is the power pair
 *   - if fcase is available in the active fsuite surface, use it to preserve continuity once the seam is known
 *   - fmetrics is observability, not a reason to spam recon
 *   - literal search is a strength, not a fallback
 *   - strong combinations: fsearch -> fmap, and fsearch -> fcontent -> fmap when exact-text confirmation is needed
 *
 * Shell tool uses child_process.exec intentionally - tool input is a full shell
 * command strings that may contain pipes, redirects, etc. This is gated behind
 * DANGEROUS_MODE=true, matching Claude provider's bypassPermissions behavior.
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { tool } from '@openai/agents';
import { z } from 'zod';

import { resolveBin } from '../utils/resolve-bin.js';
import { jobRunner } from '../jobs/index.js';
import { getApprovalDecision } from '../jobs/core/approval-policy.js';
import { prepareAgentDeepLoopJob, prepareCodeRabbitReviewJob } from '../jobs/core/job-definitions.js';
import { config } from '../config.js';
import { delegatedSessionId } from '../discord/id-mapper.js';
import { objectiveEventStore, objectiveStore } from '../autonomy/index.js';
import { getCurrentToolChatId, getCurrentToolJobId, getCurrentToolOrigin, getCurrentToolSignal } from './openai-tool-context.js';

import type { Tool } from '@openai/agents-core';

/** Maximum bytes of tool output before truncation. */
const MAX_OUTPUT_BYTES = 32_000;
/** Per-tool execution timeout in ms. */
const TOOL_TIMEOUT_MS = 30_000;
/** Hard cap for model-provided shell timeout. */
const MAX_SHELL_TIMEOUT_MS = 120_000;
/** Hard cap for model-provided shell output bytes. */
const MAX_SHELL_OUTPUT_BYTES = 128_000;

interface ShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ManagedProcessResult extends ShellCommandResult {
  timedOut: boolean;
  aborted: boolean;
}

type PatchOperationResult = {
  status: 'completed' | 'failed';
  output: string;
};



function makeStableHeadlessSeed(kind: string, value: string) {
  const digest = crypto.createHash('sha256').update(`${kind}:${value}`).digest('hex').slice(0, 16);
  return `headless:${kind}:${digest}`;
}

function resolveDelegateOrigin(
  chatId: number | undefined,
  origin: ReturnType<typeof getCurrentToolOrigin>,
  stableSeed?: string,
): { origin?: { channelId: string; userId: string; threadId?: string }; error?: string } {
  if (origin?.channelId && origin?.userId) return { origin };

  if (!config.JOB_ALLOW_HEADLESS_ORIGIN) {
    return { error: 'missing discord job origin' };
  }

  // Allow a synthetic origin fallback for delegated jobs so background tools
  // can still run in headless or non-Discord contexts when explicitly enabled.
  const seed = typeof chatId === 'number'
    ? `chat:${chatId}`
    : stableSeed
      ? makeStableHeadlessSeed('delegated-job', stableSeed)
      : 'headless:system';

  const synthetic = { channelId: seed, userId: seed };
  return { origin: synthetic };
}
// ---------------------------------------------------------------------------
//  Path validation
// ---------------------------------------------------------------------------

/** Basename patterns for sensitive files. */
const SECRET_BASENAME_PATTERNS = [
  /^\.env$/,
  /^\.env\..+$/,
  /\.key$/,
  /\.pem$/,
  /^id_rsa/,
  /^credentials\.json$/,
  /^auth\.json$/,
  /^tokens\.json$/,
  /^secrets\./,
];

/** Directory segments that indicate auth/key material. */
const SECRET_DIR_SEGMENTS = [
  '/.ssh/',
  '/.gnupg/',
  '/.codex/',
  '/.aws/',
  '/.config/gcloud/',
];

/**
 * Validates that a target path is safely within the project root.
 * Uses realpathSync on the canonical root and resolves the target
 * against it to prevent symlink escapes and prefix collisions.
 *
 * @param cwd - Project working directory
 * @param targetPath - Path to validate (may be relative or absolute)
 * @param allowNew - If true, validates parent dir for files that don't exist yet
 * @returns The canonical absolute path if valid
 * @throws Error if path escapes the project root
 */
function validatePath(cwd: string, targetPath: string, allowNew = false): string {
  const canonicalRoot = fs.realpathSync(cwd);
  const resolved = path.resolve(cwd, targetPath);

  let canonical: string;
  if (allowNew && !fs.existsSync(resolved)) {
    // For new files: validate the parent directory exists and is within root
    const parentDir = path.dirname(resolved);
    if (!fs.existsSync(parentDir)) {
      // Parent doesn't exist yet — walk up to find the deepest existing ancestor
      let ancestor = parentDir;
      while (!fs.existsSync(ancestor)) {
        const next = path.dirname(ancestor);
        if (next === ancestor) break; // filesystem root
        ancestor = next;
      }
      const canonicalAncestor = fs.realpathSync(ancestor);
      const rel = path.relative(canonicalRoot, canonicalAncestor);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`[denied] Path escapes project root: ${targetPath}`);
      }
    } else {
      const canonicalParent = fs.realpathSync(parentDir);
      const rel = path.relative(canonicalRoot, canonicalParent);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`[denied] Path escapes project root: ${targetPath}`);
      }
    }
    canonical = resolved; // file doesn't exist yet, use resolved path
  } else {
    canonical = fs.realpathSync(resolved);
    const rel = path.relative(canonicalRoot, canonical);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`[denied] Path escapes project root: ${targetPath}`);
    }
  }

  return canonical;
}

/**
 * Checks if a resolved path points to a sensitive file.
 * Matches against basename patterns and directory segments.
 */
function isSensitiveFile(resolvedPath: string): boolean {
  const basename = path.basename(resolvedPath);
  for (const pattern of SECRET_BASENAME_PATTERNS) {
    if (pattern.test(basename)) return true;
  }
  for (const segment of SECRET_DIR_SEGMENTS) {
    if (resolvedPath.includes(segment)) return true;
  }
  return false;
}

function assertNotSensitivePath(resolvedPath: string, originalPath: string): void {
  if (isSensitiveFile(resolvedPath)) {
    throw new Error(`[denied] Cannot modify sensitive file: ${originalPath}`);
  }
}

/**
 * Byte-aware string truncation. Uses Buffer.byteLength to avoid
 * clipping multibyte UTF-8 characters.
 */
function truncateByBytes(str: string, maxBytes: number): string {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  // Binary search for the right character boundary
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (Buffer.byteLength(str.slice(0, mid), 'utf8') <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return str.slice(0, lo) + '\n... [truncated]';
}

function sliceByBytes(str: string, maxBytes: number): string {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (Buffer.byteLength(str.slice(0, mid), 'utf8') <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return str.slice(0, lo);
}

function appendLimitedOutput(
  current: string,
  chunk: Buffer | string,
  maxBytes: number,
): { next: string; truncated: boolean } {
  const chunkText = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  const currentBytes = Buffer.byteLength(current, 'utf8');
  if (currentBytes >= maxBytes) {
    return { next: current, truncated: true };
  }

  const remaining = maxBytes - currentBytes;
  if (Buffer.byteLength(chunkText, 'utf8') <= remaining) {
    return { next: current + chunkText, truncated: false };
  }

  return {
    next: current + sliceByBytes(chunkText, remaining),
    truncated: true,
  };
}

function finalizeOutput(text: string, truncated: boolean): string {
  return truncated ? `${text}\n... [truncated]` : text;
}

function makeAbortError(): Error {
  const error = new Error('Tool execution aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      process.kill(pid, signal);
      return;
    }
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Ignore best-effort cleanup failures.
    }
  }
}

async function runManagedProcess(opts: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<ManagedProcessResult> {
  const { command, args, cwd, timeoutMs, maxOutputBytes, signal } = opts;
  if (signal?.aborted) {
    throw makeAbortError();
  }

  return await new Promise<ManagedProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      fn();
    };

    const terminate = (reason: 'timeout' | 'abort') => {
      if (reason === 'timeout') timedOut = true;
      if (reason === 'abort') aborted = true;
      signalProcessGroup(child.pid, 'SIGTERM');
      killTimer = setTimeout(() => signalProcessGroup(child.pid, 'SIGKILL'), 250);
      killTimer.unref();
    };

    child.stdout.on('data', (chunk) => {
      const appended = appendLimitedOutput(stdout, chunk, maxOutputBytes);
      stdout = appended.next;
      stdoutTruncated ||= appended.truncated;
    });

    child.stderr.on('data', (chunk) => {
      const appended = appendLimitedOutput(stderr, chunk, maxOutputBytes);
      stderr = appended.next;
      stderrTruncated ||= appended.truncated;
    });

    child.once('error', (error) => {
      finish(() => reject(error));
    });

    child.once('close', (code) => {
      finish(() => {
        if (aborted) {
          reject(makeAbortError());
          return;
        }
        resolve({
          stdout: finalizeOutput(stdout, stdoutTruncated),
          stderr: finalizeOutput(stderr, stderrTruncated),
          exitCode: typeof code === 'number' ? code : 1,
          timedOut,
          aborted,
        });
      });
    });

    const timeoutHandle = setTimeout(() => terminate('timeout'), timeoutMs);
    timeoutHandle.unref();

    const onAbort = signal
      ? () => {
          terminate('abort');
        }
      : undefined;

    if (signal && onAbort) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// ---------------------------------------------------------------------------
//  CLI runner (fsuite tools)
// ---------------------------------------------------------------------------

/**
 * Safely runs a CLI command via execFile (no shell interpolation).
 * Never throws — returns `[error] ...` strings on failure so the model
 * sees the error as tool output rather than crashing the run.
 */
function runCli(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return (async () => {
    try {
      const result = await runManagedProcess({
        command: resolveBin(cmd),
        args,
        cwd,
        timeoutMs: TOOL_TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        signal: getCurrentToolSignal(),
      });
      if (result.exitCode !== 0) {
        const reason = result.timedOut
          ? `${cmd} timed out after ${TOOL_TIMEOUT_MS}ms`
          : result.stderr.trim() || `exit code ${result.exitCode}`;
        return `[error] ${cmd} failed: ${reason}`;
      }
      return truncateByBytes(result.stdout, MAX_OUTPUT_BYTES);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return `[error] ${cmd} failed: ${message}`;
    }
  })();
}

// ---------------------------------------------------------------------------
//  Shell implementation (DANGEROUS_MODE only)
// ---------------------------------------------------------------------------

/**
 * Local Shell implementation for the Agents SDK shellTool.
 * Executes commands via child_process.exec (supports pipes, redirects, etc.)
 * with timeout and byte-aware output truncation.
 *
 * Uses exec() intentionally — Shell.run() receives full shell command strings.
 * Gated behind DANGEROUS_MODE=true at tool registration level.
 */
class LocalShell {
  constructor(private readonly cwd: string) {}

  async run(
    commands: string[],
    timeoutMs: number = TOOL_TIMEOUT_MS,
    maxOutputLength: number = MAX_OUTPUT_BYTES,
  ): Promise<ShellCommandResult[]> {
    const output: ShellCommandResult[] = [];
    for (const command of commands) {
      const result = await this.execCommand(command, timeoutMs, maxOutputLength);
      output.push(result);
    }
    return output;
  }

  private execCommand(
    command: string,
    timeout: number,
    maxOutput: number,
  ): Promise<ShellCommandResult> {
    return (async () => {
      const result = await runManagedProcess({
        command: 'bash',
        args: ['-lc', command],
        cwd: this.cwd,
        timeoutMs: timeout,
        maxOutputBytes: maxOutput,
        signal: getCurrentToolSignal(),
      });
      return {
        stdout: truncateByBytes(result.stdout, maxOutput),
        stderr: truncateByBytes(result.stderr, maxOutput),
        exitCode: result.exitCode,
      };
    })();
  }
}

// ---------------------------------------------------------------------------
//  Editor implementation (DANGEROUS_MODE only)
// ---------------------------------------------------------------------------

/**
 * Local Editor implementation for the Agents SDK applyPatchTool.
 * Handles create/update/delete file operations with V4A unified diffs.
 * All paths validated against the project root via realpathSync.
 */
class LocalEditor {
  constructor(private readonly cwd: string) {}

  async createFile(
    operation: { type: 'create_file'; path: string; diff?: string; content?: string },
  ): Promise<PatchOperationResult> {
    try {
      const target = validatePath(this.cwd, operation.path, true);
      assertNotSensitivePath(target, operation.path);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const content =
        typeof operation.content === 'string'
          ? operation.content
          : operation.diff
            ? extractContentFromDiff(operation.diff)
            : undefined;
      if (typeof content !== 'string') {
        throw new Error('create_file requires either content or diff');
      }
      await fs.promises.writeFile(target, content, 'utf8');
      return { status: 'completed', output: `Created ${operation.path}` };
    } catch (err) {
      return { status: 'failed', output: String(err instanceof Error ? err.message : err) };
    }
  }

  async updateFile(
    operation: { type: 'update_file'; path: string; diff: string },
  ): Promise<PatchOperationResult> {
    try {
      const target = validatePath(this.cwd, operation.path);
      assertNotSensitivePath(target, operation.path);
      const original = await fs.promises.readFile(target, 'utf8');
      const patched = applyUnifiedDiff(original, operation.diff);
      await fs.promises.writeFile(target, patched, 'utf8');
      return { status: 'completed', output: `Updated ${operation.path}` };
    } catch (err) {
      return { status: 'failed', output: String(err instanceof Error ? err.message : err) };
    }
  }

  async deleteFile(
    operation: { type: 'delete_file'; path: string },
  ): Promise<PatchOperationResult> {
    try {
      const target = validatePath(this.cwd, operation.path);
      assertNotSensitivePath(target, operation.path);
      await fs.promises.unlink(target);
      return { status: 'completed', output: `Deleted ${operation.path}` };
    } catch (err) {
      return { status: 'failed', output: String(err instanceof Error ? err.message : err) };
    }
  }
}

/**
 * Extracts file content from a V4A create_file diff.
 * Lines starting with '+' (after the @@ header) contain the new content.
 */
function extractContentFromDiff(diff: string): string {
  const lines = diff.split('\n');
  const contentLines: string[] = [];
  let inContent = false;
  let sawHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inContent = true;
      sawHunk = true;
      continue;
    }
    if (inContent && line.startsWith('+')) {
      contentLines.push(line.slice(1));
    }
  }

  if (!sawHunk) {
    throw new Error('Invalid create_file diff: missing hunk header');
  }

  return contentLines.join('\n');
}

/**
 * Applies a V4A unified diff to original file content.
 * Handles context lines (space-prefixed), additions (+), and removals (-).
 */
function applyUnifiedDiff(original: string, diff: string): string {
  if (diff.trim().length === 0) {
    throw new Error('Invalid diff: empty diff');
  }

  const originalLines = original.split('\n');
  const diffLines = diff.split('\n');
  const result: string[] = [];
  let originalIdx = 0;
  let inHunk = false;
  let sawHunk = false;
  let sawOperation = false;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    // Parse hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (hunkMatch) {
      sawHunk = true;
      inHunk = true;
      const hunkStart = parseInt(hunkMatch[1], 10) - 1; // 0-indexed
      if (hunkStart < originalIdx) {
        throw new Error(
          `Diff hunk out of order: hunk starts at line ${hunkStart + 1} ` +
          `but already at line ${originalIdx + 1}`,
        );
      }
      // Copy lines before this hunk
      while (originalIdx < hunkStart) {
        result.push(originalLines[originalIdx]);
        originalIdx++;
      }
      continue;
    }

    // Skip diff header lines
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')) {
      continue;
    }
    if (line.startsWith('\\')) {
      continue; // e.g. "\ No newline at end of file"
    }

    if (!inHunk && (line.startsWith('-') || line.startsWith('+') || line.startsWith(' '))) {
      throw new Error(`Invalid diff: operation outside hunk at line ${i + 1}`);
    }

    if (line.startsWith('-')) {
      sawOperation = true;
      // Remove line — verify it matches before skipping
      const expected = line.slice(1);
      const actual = originalLines[originalIdx];
      if (actual !== expected) {
        throw new Error(
          `Diff removal mismatch at line ${originalIdx + 1}: ` +
          `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
      }
      originalIdx++;
    } else if (line.startsWith('+')) {
      sawOperation = true;
      // Add line
      result.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      sawOperation = true;
      // Context line — verify match, then copy from original
      const expected = line.slice(1);
      const actual = originalLines[originalIdx];
      if (actual !== expected) {
        throw new Error(
          `Diff context mismatch at line ${originalIdx + 1}: ` +
          `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
      }
      result.push(actual);
      originalIdx++;
    } else if (line.length > 0 && inHunk) {
      throw new Error(`Invalid diff line at ${i + 1}: ${line}`);
    }
  }

  if (!sawHunk) {
    throw new Error('Invalid diff: no hunks found');
  }
  if (!sawOperation) {
    throw new Error('Invalid diff: no operations in hunks');
  }

  // Copy remaining original lines after last hunk
  while (originalIdx < originalLines.length) {
    result.push(originalLines[originalIdx]);
    originalIdx++;
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
//  File + shell tools (function tools only)
// ---------------------------------------------------------------------------

const readFileInputSchema = z.object({
  path: z.string().describe('File path relative to project root, e.g. "src/config.ts"'),
  offset: z.number().nullable().optional().describe('Line number to start reading from (1-indexed), or null'),
  limit: z.number().nullable().optional().describe('Maximum number of lines to read, or null'),
});

async function readFileWithLineNumbers(
  cwd: string,
  input: z.infer<typeof readFileInputSchema>,
): Promise<string> {
  try {
    const target = validatePath(cwd, input.path);

    if (isSensitiveFile(target)) {
      return '[denied] Cannot read sensitive files';
    }

    const stat = await fs.promises.stat(target);
    if (stat.isDirectory()) {
      return '[error] Path is a directory, not a file. Use ftree to explore directories.';
    }

    const content = await fs.promises.readFile(target, 'utf8');
    let lines = content.split('\n');

    const offset = Math.max(0, ((input.offset ?? null) ?? 1) - 1);
    const limit = (input.limit ?? null) ?? lines.length;
    lines = lines.slice(offset, offset + limit);

    const formatted = lines
      .map((line, i) => {
        const lineNum = String(offset + i + 1).padStart(6, ' ');
        return `${lineNum}→${line}`;
      })
      .join('\n');

    return truncateByBytes(formatted, MAX_OUTPUT_BYTES);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[error] read failed: ${msg}`;
  }
}

function createReadFileTool(cwd: string) {
  return tool({
    name: 'read_file',
    description:
      'Read a file from the project directory. Returns contents with line numbers. ' +
      'The path must be relative to the project root or an absolute path within it. ' +
      'Cannot read sensitive files (.env, keys, credentials).',
    parameters: readFileInputSchema,
    execute: async (input) => readFileWithLineNumbers(cwd, input),
  });
}

function createReadTool(cwd: string) {
  return tool({
    name: 'read',
    description:
      'Read a file with line numbers. Alias of read_file for Codex-style tool names.',
    parameters: readFileInputSchema,
    execute: async (input) => readFileWithLineNumbers(cwd, input),
  });
}

function createWriteTool(cwd: string) {
  return tool({
    name: 'write',
    description:
      'Write content to a file (creates parent directories as needed). Overwrites existing file content.',
    parameters: z.object({
      path: z.string().describe('File path relative to project root'),
      content: z.string().describe('Full file content to write'),
    }),
    execute: async ({ path: filePath, content }) => {
      try {
        const target = validatePath(cwd, filePath, true);
        assertNotSensitivePath(target, filePath);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, content, 'utf8');
        return `Wrote ${filePath}`;
      } catch (err) {
        return `[error] write failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

function createEditTool(cwd: string) {
  return tool({
    name: 'edit',
    description:
      'Edit a file using string replacement. Replaces the first match by default.',
    parameters: z.object({
      path: z.string().describe('File path relative to project root'),
      old_text: z.string().describe('Text to replace'),
      new_text: z.string().describe('Replacement text'),
      replace_all: z.boolean().nullable().optional().describe('Replace all matches (default false)'),
    }),
    execute: async ({ path: filePath, old_text, new_text, replace_all }) => {
      try {
        const target = validatePath(cwd, filePath);
        assertNotSensitivePath(target, filePath);
        const content = await fs.promises.readFile(target, 'utf8');
        if (!content.includes(old_text)) {
          return `[error] edit failed: text not found in ${filePath}`;
        }
        const updated = replace_all
          ? content.split(old_text).join(new_text)
          : content.replace(old_text, () => new_text);
        await fs.promises.writeFile(target, updated, 'utf8');
        return `Edited ${filePath}`;
      } catch (err) {
        return `[error] edit failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

function createShellFunctionTool(cwd: string, name: 'shell' | 'exec') {
  const shell = new LocalShell(cwd);
  const schema = z.object({
    commands: z.array(z.string()).nullable().optional().describe('Commands to execute in order'),
    command: z.string().nullable().optional().describe('Single command to execute'),
    timeout_ms: z.number().nullable().optional().describe('Per-command timeout in ms (default 30000)'),
    max_output_bytes: z.number().nullable().optional().describe('Max stdout/stderr bytes per command (default 32000)'),
  });

  return tool({
    name,
    description:
      'Run shell commands in the project working directory. Supports pipes, redirects, and shell syntax.',
    parameters: schema,
    execute: async (input) => {
      try {
        const commands = (input.commands ?? []).filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
        if (input.command && input.command.trim().length > 0) {
          commands.push(input.command);
        }
        if (commands.length === 0) {
          return '[error] shell requires command or commands';
        }

        const timeout = input.timeout_ms ?? TOOL_TIMEOUT_MS;
        const clampedTimeout = Math.min(
          MAX_SHELL_TIMEOUT_MS,
          Math.max(1_000, timeout),
        );
        const maxOutput = input.max_output_bytes ?? MAX_OUTPUT_BYTES;
        const clampedMaxOutput = Math.min(
          MAX_SHELL_OUTPUT_BYTES,
          Math.max(1_024, maxOutput),
        );
        const results = await shell.run(commands, clampedTimeout, clampedMaxOutput);

        return results
          .map((result, idx) => {
            const chunks = [
              `$ ${commands[idx]}`,
              `exit_code: ${result.exitCode}`,
            ];
            if (result.stdout) chunks.push(`stdout:\n${result.stdout}`);
            if (result.stderr) chunks.push(`stderr:\n${result.stderr}`);
            return chunks.join('\n');
          })
          .join('\n\n');
      } catch (err) {
        return `[error] shell failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

function createApplyPatchFunctionTool(cwd: string) {
  const editor = new LocalEditor(cwd);

  const createFileSchema = z.object({
    type: z.literal('create_file'),
    path: z.string(),
    content: z.string().nullable().optional().describe('Full file content for new file'),
    diff: z.string().nullable().optional().describe('Optional V4A diff for create operation'),
  });
  const updateFileSchema = z.object({
    type: z.literal('update_file'),
    path: z.string(),
    diff: z.string().describe('V4A unified diff to apply'),
  });
  const deleteFileSchema = z.object({
    type: z.literal('delete_file'),
    path: z.string(),
  });
  const operationSchema = z.union([createFileSchema, updateFileSchema, deleteFileSchema]);

  return tool({
    name: 'apply_patch',
    description:
      'Apply file patch operations (create_file, update_file, delete_file). ' +
      'update_file requires a V4A unified diff.',
    parameters: z.object({
      operations: z.array(operationSchema).min(1),
    }),
    execute: async ({ operations }) => {
      const outputs: string[] = [];
      for (const op of operations) {
        let result: PatchOperationResult;
        if (op.type === 'create_file') {
          result = await editor.createFile({
            type: 'create_file',
            path: op.path,
            content: op.content ?? undefined,
            diff: op.diff ?? undefined,
          });
        } else if (op.type === 'update_file') {
          result = await editor.updateFile(op);
        } else {
          result = await editor.deleteFile(op);
        }
        outputs.push(`${result.status}: ${result.output}`);
      }
      return outputs.join('\n');
    },
  });
}

function makeIdempotencyKey(name: string, origin: { channelId: string; userId: string; threadId?: string }, payload: unknown): string {
  const raw = JSON.stringify({ name, channelId: origin.channelId, userId: origin.userId, threadId: origin.threadId, payload });
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function createDelegatedChildChatId(parentChatId: number, task: string, model?: string | null): number {
  return delegatedSessionId(`${parentChatId}:${model ?? 'spark'}:${task}:${crypto.randomUUID()}`);
}

function buildReturnRoute(chatId: number | null | undefined, origin: { guildId?: string; channelId: string; threadId?: string; userId: string }, mode: 'origin' | 'parent-session') {
  return {
    platform: 'discord' as const,
    channelId: origin.channelId,
    threadId: origin.threadId,
    guildId: typeof (origin as any).guildId === 'string' ? (origin as any).guildId : undefined,
    userId: origin.userId,
    parentChatId: typeof chatId === 'number' ? chatId : undefined,
    mode,
    capturedAt: Date.now(),
  };
}

function createDelegateDeepTaskTool() {
  return tool({
    name: 'delegate_deep_task',
    description:
      'Delegate a deep task to the autonomous background loop. Returns immediately with a jobId. ' +
      'Delegated agents inherit the same fsuite doctrine in compressed form: ftree once when orientation is needed, ' +
      'start with fsearch, use fcontent only to confirm exact text, then let fmap + fread carry the seam.',
    parameters: z.object({
      task: z.string().describe('Deep task objective to execute in the loop'),
      model: z.string().nullable().optional().describe('Optional model override for the deep loop'),
      max_iterations: z.number().nullable().optional().describe('Optional max loop iterations (default 24)'),
    }),
    execute: async ({ task, model, max_iterations }) => {
      try {
        const chatId = getCurrentToolChatId();
        const parentJobId = getCurrentToolJobId();
        const trimmed = task.trim();
        if (!trimmed) {
          return '[error] delegate_deep_task requires non-empty task';
        }
        if (typeof chatId !== 'number' && !config.JOB_ALLOW_HEADLESS_ORIGIN) {
          return '[error] delegate_deep_task unavailable: missing chat context';
        }

        const requestedModel = model ?? 'gpt-5.3-codex-spark';
        const effectiveParentChatId = typeof chatId === 'number'
          ? chatId
          : delegatedSessionId(makeStableHeadlessSeed('parent-chat', `${trimmed}:${requestedModel}:${max_iterations ?? ''}`));
        const childChatId = createDelegatedChildChatId(effectiveParentChatId, trimmed, requestedModel);
        const timeoutMs = 1000 * 60 * 30;
        const handoff = typeof chatId === 'number'
          ? { mode: 'parent-session' as const, parentChatId: effectiveParentChatId, platform: 'discord' as const }
          : undefined;
        const job = prepareAgentDeepLoopJob({
          name: 'agent:autonomous-deep-loop',
          lane: 'subagent',
          timeoutMs,
          handoff,
          payload: {
            parentChatId: effectiveParentChatId,
            childChatId,
            task: trimmed,
            model: requestedModel,
            maxIterations:
              typeof max_iterations === 'number'
                ? Math.max(1, Math.min(64, Math.floor(max_iterations)))
                : undefined,
          },
        });

        const originResolved = resolveDelegateOrigin(
          chatId,
          getCurrentToolOrigin(),
          `deep-task:${trimmed}:${requestedModel}:${max_iterations ?? ''}`,
        );
        if (!originResolved.origin) {
          return '[error] delegate_deep_task unavailable: ' + (originResolved.error ?? 'missing origin');
        }
        const origin = originResolved.origin;
        const returnRoute = buildReturnRoute(
          typeof chatId === 'number' ? effectiveParentChatId : chatId,
          origin,
          handoff ? 'parent-session' : 'origin',
        );

        const idempotencyKey = makeIdempotencyKey('agent:autonomous-deep-loop', origin, {
          chatId: typeof chatId === 'number' ? chatId : null,
          task: trimmed,
          model: requestedModel,
          max_iterations: max_iterations ?? null,
        });

        const jobName = job.name;
        const decision = getApprovalDecision(jobName, timeoutMs);
        if (decision.requiresApproval) {
          return `[error] ${jobName} requires approval (${decision.reason}). Run via /devops for approval flow.`;
        }

        const jobId = jobRunner.enqueue({
          name: job.name,
          lane: job.lane,
          origin,
          handler: job.handler,
          timeoutMs: job.timeoutMs,
          idempotencyKey,
          parentJobId,
          resumeSpec: job.resumeSpec,
          handoff: job.handoff,
          returnRoute,
        });
        if (typeof chatId === 'number') {
          objectiveStore.create({
            chatId: effectiveParentChatId,
            platform: 'discord',
            channelId: origin.channelId,
            threadId: origin.threadId,
            guildId: typeof (origin as any).guildId === 'string' ? (origin as any).guildId : undefined,
            userId: origin.userId,
            summary: trimmed,
            nextActions: ['Wait for delegated job completion.'],
            parentJobId,
            childJobIds: [jobId],
            returnRoute,
            budget: { maxAutonomyMinutes: 15, maxDelegations: 3, maxFollowups: 3 },
          });
        }

        return JSON.stringify({
          status: 'queued',
          jobId,
          childChatId,
          model: requestedModel,
          parentJobId: parentJobId ?? null,
          timeoutMinutes: 30,
        });
      } catch (err) {
        return `[error] delegate_deep_task failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

function createDelegateCodeRabbitReviewTool(cwd: string) {
  return tool({
    name: 'delegate_coderabbit_review',
    description:
      'Queue a CodeRabbit review job with prompt-only mode enabled. Returns immediately with job id(s).',
    parameters: z.object({
      base_ref: z.string().nullable().optional().describe('Base ref to diff against (default: origin/main)'),
      target: z
        .enum(['committed', 'uncommitted', 'all'])
        .nullable()
        .optional()
        .describe('What to review (default: committed)'),
      repo_path: z.string().nullable().optional().describe('Optional repo path override (default: current cwd)'),
    }),
    execute: async ({ base_ref, target, repo_path }) => {
      try {
        const baseRef = (base_ref ?? 'origin/main').trim() || 'origin/main';
        const selectedTarget = target ?? 'committed';
        const repoPath = (repo_path ?? cwd).trim() || cwd;
        const targets: Array<'committed' | 'uncommitted'> =
          selectedTarget === 'all' ? ['committed', 'uncommitted'] : [selectedTarget];

        const chatId = getCurrentToolChatId();
        const parentJobId = getCurrentToolJobId();
        const toolOriginResolved = resolveDelegateOrigin(
          chatId,
          getCurrentToolOrigin(),
          `coderabbit:${repoPath}:${baseRef}:${selectedTarget}:prompt-only`,
        );
        if (!toolOriginResolved.origin) {
          return '[error] delegate_coderabbit_review unavailable: ' + (toolOriginResolved.error ?? 'missing origin');
        }
        const toolOrigin = toolOriginResolved.origin;
        const returnRoute = buildReturnRoute(
          chatId,
          toolOrigin,
          typeof chatId === 'number' ? 'parent-session' : 'origin',
        );

        const jobIds = targets.map((t) => {
          const idempotencyKey = makeIdempotencyKey('coderabbit-review', toolOrigin, {
            repoPath,
            baseRef,
            target: t,
            promptOnly: true,
          });
          const timeoutMs = 1000 * 60 * 20;
          const job = prepareCodeRabbitReviewJob({
            timeoutMs,
            handoff: typeof chatId === 'number'
              ? { mode: 'parent-session', parentChatId: chatId, platform: 'discord' }
              : undefined,
            payload: {
              repoPath,
              baseRef,
              target: t,
              promptOnly: true,
            },
          });
          const jobName = job.name;
          const decision = getApprovalDecision(jobName, timeoutMs);
          if (decision.requiresApproval) {
            throw new Error(`${jobName} requires approval (${decision.reason}). Run via /devops for approval flow.`);
          }
          const jobId = jobRunner.enqueue({
            name: job.name,
            lane: job.lane,
            origin: toolOrigin,
            handler: job.handler,
            timeoutMs: job.timeoutMs,
            idempotencyKey,
            parentJobId,
            resumeSpec: job.resumeSpec,
            handoff: job.handoff,
            returnRoute,
          });
          if (typeof chatId === 'number') {
            objectiveStore.create({
              chatId,
              platform: 'discord',
              channelId: toolOrigin.channelId,
              threadId: toolOrigin.threadId,
              guildId: typeof (toolOrigin as any).guildId === 'string' ? (toolOrigin as any).guildId : undefined,
              userId: toolOrigin.userId,
              summary: `CodeRabbit review (${t}) for ${repoPath}`,
              nextActions: ['Wait for review completion.'],
              parentJobId,
              childJobIds: [jobId],
              returnRoute,
              budget: { maxAutonomyMinutes: 15, maxDelegations: 2, maxFollowups: 2 },
            });
          }
          return jobId;
        });

        return JSON.stringify({
          status: 'queued',
          mode: 'prompt-only',
          baseRef,
          target: selectedTarget,
          repoPath,
          jobIds,
          parentJobId: parentJobId ?? null,
        });
      } catch (err) {
        return `[error] delegate_coderabbit_review failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

function createDelegateCodexHighReviewTool() {
  return tool({
    name: 'delegate_codex_high_review',
    description:
      'Queue a strict deep review loop using primary model (gpt-5.4) for feature/code review tasks. ' +
      'Subagents should keep the same fsuite doctrine: orient once, narrow with fsearch, confirm with fcontent, ' +
      'then use fmap + fread for the deep read.',
    parameters: z.object({
      task: z.string().describe('What should be reviewed or validated'),
      max_iterations: z.number().nullable().optional().describe('Optional max loop iterations (default 24)'),
    }),
    execute: async ({ task, max_iterations }) => {
      try {
        const chatId = getCurrentToolChatId();
        const parentJobId = getCurrentToolJobId();
        const trimmed = task.trim();
        if (!trimmed) {
          return '[error] delegate_codex_high_review requires non-empty task';
        }
        if (typeof chatId !== 'number' && !config.JOB_ALLOW_HEADLESS_ORIGIN) {
          return '[error] delegate_codex_high_review unavailable: missing chat context';
        }

        const reviewTask = [
          'Perform an extra-high strict code/plan review.',
          'Output: critical issues first, then risks, then exact fixes.',
          `Task: ${trimmed}`,
        ].join('\n');

        const effectiveParentChatId = typeof chatId === 'number'
          ? chatId
          : delegatedSessionId(makeStableHeadlessSeed('parent-chat', `${reviewTask}:${max_iterations ?? ''}`));
        const childChatId = createDelegatedChildChatId(effectiveParentChatId, reviewTask, 'gpt-5.4');
        const timeoutMs = 1000 * 60 * 30;
        const job = prepareAgentDeepLoopJob({
          name: 'agent:codex-high-review',
          lane: 'review',
          timeoutMs,
          handoff: typeof chatId === 'number'
            ? { mode: 'parent-session', parentChatId: effectiveParentChatId, platform: 'discord' }
            : undefined,
          payload: {
            parentChatId: effectiveParentChatId,
            childChatId,
            task: reviewTask,
            model: 'gpt-5.4',
            maxIterations:
              typeof max_iterations === 'number'
                ? Math.max(1, Math.min(64, Math.floor(max_iterations)))
                : undefined,
          },
        });

        const originResolved = resolveDelegateOrigin(
          chatId,
          getCurrentToolOrigin(),
          `codex-high-review:${reviewTask}:${max_iterations ?? ''}`,
        );
        if (!originResolved.origin) {
          return '[error] delegate_codex_high_review unavailable: ' + (originResolved.error ?? 'missing origin');
        }
        const origin = originResolved.origin;
        const returnRoute = buildReturnRoute(
          typeof chatId === 'number' ? effectiveParentChatId : chatId,
          origin,
          typeof chatId === 'number' ? 'parent-session' : 'origin',
        );

        const idempotencyKey = makeIdempotencyKey('agent:codex-high-review', origin, {
          chatId: typeof chatId === 'number' ? chatId : null,
          task: reviewTask,
          model: 'gpt-5.4',
          max_iterations: max_iterations ?? null,
        });

        const jobName = job.name;
        const decision = getApprovalDecision(jobName, timeoutMs);
        if (decision.requiresApproval) {
          return `[error] ${jobName} requires approval (${decision.reason}). Run via /devops for approval flow.`;
        }

        const jobId = jobRunner.enqueue({
          name: job.name,
          lane: job.lane,
          origin,
          handler: job.handler,
          timeoutMs: job.timeoutMs,
          idempotencyKey,
          parentJobId,
          resumeSpec: job.resumeSpec,
          handoff: job.handoff,
          returnRoute,
        });
        if (typeof chatId === 'number') {
          objectiveStore.create({
            chatId: effectiveParentChatId,
            platform: 'discord',
            channelId: origin.channelId,
            threadId: origin.threadId,
            guildId: typeof (origin as any).guildId === 'string' ? (origin as any).guildId : undefined,
            userId: origin.userId,
            summary: trimmed,
            nextActions: ['Wait for high-review completion.'],
            parentJobId,
            childJobIds: [jobId],
            returnRoute,
            budget: { maxAutonomyMinutes: 15, maxDelegations: 2, maxFollowups: 2 },
          });
        }

        return JSON.stringify({
          status: 'queued',
          jobId,
          childChatId,
          model: 'gpt-5.4',
          parentJobId: parentJobId ?? null,
        });
      } catch (err) {
        return `[error] delegate_codex_high_review failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

// ---------------------------------------------------------------------------
//  fsuite tool definitions
// ---------------------------------------------------------------------------

function createFsuiteOnlyTools(cwd: string) {
  return [
    tool({
      name: 'ftree',
      description:
        'Intentional territory scan for first contact. Use ftree once, when appropriate, to establish the project shape, ' +
        'then switch to narrower fsuite sensors instead of repeating broad recon. ' +
        'Flags: -L <n> (depth, default 3), -o pretty|paths|json (prefer pretty for humans, paths for piping, json for programmatic decisions), ' +
        '-d (dirs only), -s (show sizes), -r/--recon (per-dir item counts + sizes), ' +
        '--snapshot (combined recon + tree), -I <pattern> (extra ignores), ' +
        '--include <name> (un-ignore a dir), --hide-excluded (suppress excluded summaries). ' +
        'No arguments = full tree from cwd at depth 3.',
      parameters: z.object({
        args: z
          .string()
          .nullable()
          .describe('CLI arguments, e.g. "-L 5 src/" or "--recon -o json" or "--snapshot"'),
      }),
      execute: async (input) => {
        const args = input.args ? input.args.split(/\s+/) : [];
        return runCli('ftree', args, cwd);
      },
    }),

    tool({
      name: 'fsearch',
      description:
        'Primary narrowing tool for filenames and paths using glob patterns and extensions, not content search. ' +
        'Start here to cut the candidate set before content confirmation or deep reads. ' +
        'Literal path/filename search is a strength, not a fallback. ' +
        "Usage: fsearch <pattern_or_ext> [path]. " +
        "Pattern examples: 'upscale*' (starts-with), '*progress*' (contains), " +
        "'.log' or 'log' (extension search), '*error' (ends-with). " +
        'Flags: -m <n> (max results), -o pretty|paths|json (prefer paths for piping, json for programmatic decisions, pretty for humans), -b auto|find|fd (backend). ' +
        'Strong combination: fsearch -> fmap.',
      parameters: z.object({
        query: z.string().describe("Glob pattern or file extension to search for, e.g. '*.ts', 'config*', '.log'"),
        args: z
          .string()
          .nullable()
          .describe('Additional CLI arguments, e.g. "-o json -m 20 src/"'),
      }),
      execute: async (input) => {
        const args = [input.query];
        if (input.args) args.push(...input.args.split(/\s+/));
        return runCli('fsearch', args, cwd);
      },
    }),

      tool({
        name: 'fcontent',
        description:
          'Search file contents for matching text (grep-like). ' +
          'Use it after fsearch has already narrowed the field, for exact-text confirmation rather than broad discovery. ' +
          'Literal search is a strength here, not a fallback. ' +
          'The query argument is a search term, NOT a file path. ' +
          'Returns matching lines with context. ' +
          'Usage: fcontent <query> - searches for the query text across files in the working directory. ' +
          'In the wider fsuite doctrine, use fcontent only after narrowing and treat it as exact-text confirmation before deeper symbol work.',
        parameters: z.object({
          query: z.string().describe('Text pattern to search for in file contents'),
        }),
      execute: async (input) => {
        return runCli('fcontent', [input.query], cwd);
      },
    }),

      tool({
        name: 'fmap',
        description:
          'Code cartography - fmap is the bridge in the middle, turning narrowed files into symbol-level territory. ' +
          'Use it after fsearch or fcontent, then pair it with fread for the deep read. ' +
        'Supports 12 languages (Python, JS, TS, Rust, Go, Java, C, C++, Ruby, Lua, PHP, Bash). ' +
        'Modes: fmap <dir> (scan all files), fmap <file> (single file), piped: fsearch -o paths "*.py" | fmap. ' +
        'Flags: -o pretty|paths|json (prefer paths for piping, json for programmatic decisions, pretty for humans), -t <type> (function|class|import|type|export|constant), ' +
        '-L <lang> (force language), -m <n> (max symbols), -n <n> (max files), --no-imports.',
      parameters: z.object({
        args: z
          .string()
          .nullable()
          .describe('CLI arguments, e.g. "src/" or "-t function -o json" or "-L python src/"'),
      }),
        execute: async (input) => {
          const args = input.args ? input.args.split(/\s+/) : [];
          return runCli('fmap', args, cwd);
        },
      }),

      tool({
        name: 'fread',
        description:
          'Budgeted file reading with line numbers, token estimates, and pipeline integration. ' +
          'Use this after ftree/fsearch/fcontent/fmap identify the target; fmap + fread is the power pair once the seam is known. ' +
          'Examples: "--head 80 path/to/file", "-r 120:220 path/to/file", "--around-line 150 -B 8 -A 20 path/to/file", ' +
          '"--around pattern -B 5 -A 10 path/to/file". Supports --from-stdin with paths or unified-diff.',
        parameters: z.object({
          args: z
            .string()
            .describe('Full fread arguments, e.g. "--head 80 src/file.ts" or "-r 120:220 src/file.ts"'),
        }),
        execute: async (input) => {
          const args = input.args.split(/\s+/);
          return runCli('fread', args, cwd);
        },
      }),

      tool({
        name: 'fmetrics',
      description:
        'Performance telemetry and analytics for fsuite tools. ' +
        'This is observability, not a reason to spam recon or repeat discovery you already finished. ' +
        'Subcommands: stats (usage dashboard), history (recent runs), predict <path> (estimate runtimes), ' +
        'profile (machine info), import (ingest telemetry), clean (prune old data). ' +
        'Flags: -o pretty|json (prefer json for programmatic decisions, pretty for humans). History: --tool <name>, --project <name>, --limit <n>. ' +
        'Predict: --tool <name>. Clean: --days <n>, --dry-run.',
      parameters: z.object({
        args: z
          .string()
          .nullable()
          .describe('CLI arguments, e.g. "stats -o json" or "history --tool ftree --limit 10" or "predict /project"'),
      }),
      execute: async (input) => {
        const args = input.args ? input.args.split(/\s+/) : [];
        return runCli('fmetrics', args, cwd);
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------

/**
 * Creates tool definitions scoped to a working directory.
 *
 * @param cwd - The project working directory for all tool invocations
 * @param dangerousMode - When true, includes shell and file editing tools
 * @returns Array of tool instances for the Agent constructor
 */
export function createFsuiteTools(cwd: string, dangerousMode: boolean): Tool[] {
  const tools: Tool[] = [
    ...createFsuiteOnlyTools(cwd),
    createReadFileTool(cwd),
    createReadTool(cwd),
    createDelegateDeepTaskTool(),
    createDelegateCodeRabbitReviewTool(cwd),
    createDelegateCodexHighReviewTool(),
  ];

  if (dangerousMode) {
    tools.push(
      createShellFunctionTool(cwd, 'shell'),
      createShellFunctionTool(cwd, 'exec'),
      createWriteTool(cwd),
      createEditTool(cwd),
      createApplyPatchFunctionTool(cwd),
    );
  }

  return tools;
}
