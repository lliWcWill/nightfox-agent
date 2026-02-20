/**
 * Custom fsuite tools for the OpenAI Agents SDK.
 *
 * Wraps the native fsuite CLI tools (ftree, fsearch, fcontent, fmap, fmetrics)
 * as Agent SDK `tool()` definitions so the model can explore the filesystem.
 */

import { execFile } from 'node:child_process';
import { tool } from '@openai/agents';
import { z } from 'zod';

/** Maximum bytes of tool output before truncation. */
const MAX_OUTPUT_BYTES = 32_000;
/** Per-tool execution timeout in ms. */
const TOOL_TIMEOUT_MS = 30_000;

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
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: TOOL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES * 2 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr?.trim() || error.message;
          resolve(`[error] ${cmd} failed: ${msg}`);
          return;
        }
        let output = stdout;
        if (output.length > MAX_OUTPUT_BYTES) {
          output = output.slice(0, MAX_OUTPUT_BYTES) + '\n... [truncated]';
        }
        resolve(output);
      },
    );
  });
}

/**
 * Creates the fsuite tool definitions scoped to a working directory.
 *
 * @param cwd - The project working directory for all tool invocations
 * @returns Array of FunctionTool instances for the Agent constructor
 */
export function createFsuiteTools(cwd: string) {
  return [
    tool({
      name: 'ftree',
      description:
        'Show a tree view of the project directory structure. ' +
        'Accepts optional flags: --depth <n>, --show-hidden, --show-size, --dirs-only, ' +
        '--filter <glob>, --hide-excluded. No arguments = full tree from cwd.',
      parameters: z.object({
        args: z
          .string()
          .optional()
          .describe('CLI arguments, e.g. "--depth 2 --show-size" or "src/"'),
      }),
      execute: async (input) => {
        const args = input.args ? input.args.split(/\s+/) : [];
        return runCli('ftree', args, cwd);
      },
    }),

    tool({
      name: 'fsearch',
      description:
        'Search file contents using regex or literal patterns. ' +
        'Usage: fsearch <pattern> [path] [flags]. ' +
        'Flags: -i (case-insensitive), -w (word), -l (files only), ' +
        '--type <ext>, --depth <n>, --context <n>.',
      parameters: z.object({
        pattern: z.string().describe('Search pattern (regex or literal)'),
        args: z
          .string()
          .optional()
          .describe('Additional CLI arguments, e.g. "--type ts --context 3 src/"'),
      }),
      execute: async (input) => {
        const args = [input.pattern];
        if (input.args) args.push(...input.args.split(/\s+/));
        return runCli('fsearch', args, cwd);
      },
    }),

    tool({
      name: 'fcontent',
      description:
        'Read file contents with optional line range. ' +
        'Usage: fcontent <query> where query is a file path, optionally with :startLine-endLine. ' +
        'Returns file contents with line numbers.',
      parameters: z.object({
        query: z.string().describe('File path, optionally with :startLine-endLine range'),
      }),
      execute: async (input) => {
        return runCli('fcontent', [input.query], cwd);
      },
    }),

    tool({
      name: 'fmap',
      description:
        'Code cartography — extract symbols (functions, classes, types, imports) from source files. ' +
        'Supports 15+ languages. Usage: fmap [path] [flags]. ' +
        'Flags: --imports, --depth <n>, --type <ext>.',
      parameters: z.object({
        args: z
          .string()
          .optional()
          .describe('CLI arguments, e.g. "src/ --imports" or "--type ts --depth 2"'),
      }),
      execute: async (input) => {
        const args = input.args ? input.args.split(/\s+/) : [];
        return runCli('fmap', args, cwd);
      },
    }),

    tool({
      name: 'fmetrics',
      description:
        'Code metrics — lines of code, comment ratio, complexity estimates per file or directory. ' +
        'Usage: fmetrics [path] [flags]. Flags: --type <ext>, --sort <metric>, --top <n>.',
      parameters: z.object({
        args: z
          .string()
          .optional()
          .describe('CLI arguments, e.g. "src/ --sort loc --top 10"'),
      }),
      execute: async (input) => {
        const args = input.args ? input.args.split(/\s+/) : [];
        return runCli('fmetrics', args, cwd);
      },
    }),
  ];
}
