import { execFile } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { sendToAgent } from '../../claude/agent.js';
import { execDroidJSON } from '../../droid/droid-bridge.js';
import type { GeminiTool } from './gemini-live.js';

// ── Types ────────────────────────────────────────────────────────────

export interface AgentToolContext {
  guildId: string;
  /** Synthetic numeric chatId for sendToAgent (hash of guildId). */
  chatId: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

const MEMORY_DB_PATH = join(homedir(), '.shieldcortex', 'memories.db');
const MAX_TEXT = 4000;
const truncate = (s: string, max = MAX_TEXT) => s.length > max ? s.slice(0, max) + '…' : s;

/**
 * Derives a stable negative integer chatId from a guild ID string.
 *
 * The result is deterministic and guaranteed to be negative to avoid colliding with real chat IDs.
 *
 * @param guildId - The guild identifier to convert
 * @returns A stable negative integer derived from `guildId` suitable for use as a synthetic chatId
 */
function guildIdToChat(guildId: string): number {
  let hash = 0;
  for (let i = 0; i < guildId.length; i++) {
    hash = ((hash << 5) - hash + guildId.charCodeAt(i)) | 0;
  }
  // Keep it negative so it never collides with real Telegram/Discord chat IDs
  return hash < 0 ? hash : -(hash + 1);
}

/**
 * Execute a shell command via `bash -c` and return its truncated output and exit status.
 *
 * @param command - The shell command to execute.
 * @param timeoutMs - Maximum time in milliseconds to allow the command to run before timing out (default 30000).
 * @returns An object with `stdout` and `stderr` (both truncated) and `exitCode` (`0` on success, non-zero on failure).
 */
function execCommand(
  command: string,
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile('bash', ['-c', command], { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: truncate(stdout || ''),
        stderr: truncate(stderr || ''),
        exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      });
    });
  });
}

/**
 * Create a GeminiTool that searches the persistent memories database for relevant items.
 *
 * The produced tool performs a full-text search of the memories store and is intended for use
 * when user-provided context, notes, or past decisions may help answer a question.
 *
 * @returns A GeminiTool named `"search_memory"` whose `execute` performs an FTS query and returns up to 5 matches. Successful results include `results` (array of objects with `title`, truncated `content`, and `category`) and `count`. If no matches are found the result contains `results` as an empty array and a `message`. On failure the result contains an `error` string describing the problem.
 */

function createSearchMemory(): GeminiTool {
  return {
    name: 'search_memory',
    description:
      'Search the persistent knowledge base for relevant memories, notes, and decisions. Use when the user asks about something they previously stored, or when context would help answer a question.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find relevant memories.',
        },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'Query is required.' };

      let db: InstanceType<typeof Database> | undefined;
      try {
        db = new Database(MEMORY_DB_PATH, { readonly: true });
        const rows = db.prepare(`
          SELECT m.title, m.content, m.category
          FROM memories m
          JOIN memories_fts fts ON m.id = fts.rowid
          WHERE memories_fts MATCH ?
          ORDER BY rank
          LIMIT 5
        `).all(query) as { title: string; content: string; category: string }[];

        if (rows.length === 0) return { results: [], message: 'No memories found matching that query.' };
        return {
          results: rows.map((r) => ({
            title: r.title,
            content: truncate(r.content, 500),
            category: r.category,
          })),
          count: rows.length,
        };
      } catch (err: any) {
        return { error: `Memory search failed: ${err.message}` };
      } finally {
        db?.close();
      }
    },
  };
}

/**
 * Create a Gemini tool that saves a titled memory into the persistent knowledge base.
 *
 * The tool requires a `title` and `content`; it inserts a long-term note and an FTS entry.
 *
 * @returns A `GeminiTool` whose `execute` accepts `title` and `content` and returns `{ success: true, id: number, message: string }` on success or `{ error: string }` on failure.
 */
function createRemember(): GeminiTool {
  return {
    name: 'remember',
    description:
      'Save a piece of information to the persistent knowledge base for future recall. Use when the user asks you to remember something or when important context should be preserved.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title for the memory (e.g. "User prefers dark mode").',
        },
        content: {
          type: 'string',
          description: 'Detailed content to remember.',
        },
      },
      required: ['title', 'content'],
    },
    execute: async (args) => {
      const title = String(args.title || '').trim();
      const content = String(args.content || '').trim();
      if (!title || !content) return { error: 'Both title and content are required.' };

      let db: InstanceType<typeof Database> | undefined;
      try {
        db = new Database(MEMORY_DB_PATH);
        const insert = db.transaction(() => {
          const result = db!.prepare(`
            INSERT INTO memories (type, category, title, content, project, salience, scope, source)
            VALUES ('long_term', 'note', ?, ?, 'claudegram', 0.6, 'project', 'agent:discord-voice')
          `).run(title, content);

          db!.prepare(`
            INSERT INTO memories_fts (rowid, title, content, tags)
            VALUES (?, ?, ?, '[]')
          `).run(result.lastInsertRowid, title, content);

          return result;
        });

        const result = insert();
        return { success: true, id: Number(result.lastInsertRowid), message: `Saved memory: ${title}` };
      } catch (err: any) {
        return { error: `Failed to save memory: ${err.message}` };
      } finally {
        db?.close();
      }
    },
  };
}

/**
 * Create a Gemini tool that delegates a detailed task to Claude (Anthropic) for background processing.
 *
 * The tool accepts a `task` string and runs non-blocking work routed via the provided agent context; requests that exceed 120 seconds are aborted. On success the tool returns a truncated `response` text, `toolsUsed`, and an `instruction` for verbal summarization. On failure it returns an `error` message.
 *
 * @param ctx - Agent context containing guild and derived chat identifiers used to route the request
 * @returns A `GeminiTool` configured with a required `task` parameter, `NON_BLOCKING` behavior, and an `execute` implementation that delegates to Claude and returns `{ response, toolsUsed, instruction }` on success or `{ error }` on failure
 */
function createAskClaude(ctx: AgentToolContext): GeminiTool {
  return {
    name: 'ask_claude',
    description:
      'Delegate a complex task to Claude (Anthropic AI). Use for code generation, deep analysis, writing, debugging, or anything requiring strong reasoning. Runs in the background — the conversation can continue while Claude works.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Detailed description of the task for Claude.',
        },
      },
      required: ['task'],
    },
    behavior: 'NON_BLOCKING',
    execute: async (args) => {
      const task = String(args.task || '').trim();
      if (!task) return { error: 'Task description is required.' };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await sendToAgent(ctx.chatId, task, {
          platform: 'discord',
          abortController: controller,
        });

        return {
          response: truncate(response.text),
          toolsUsed: response.toolsUsed,
          instruction: 'Summarize Claude\'s response verbally. Keep it concise for speech.',
        };
      } catch (err: any) {
        if (controller.signal.aborted) {
          return { error: 'Claude request timed out after 120 seconds.' };
        }
        return { error: `Claude request failed: ${err.message}` };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Creates a GeminiTool that runs Factory Droid (Groq LPU) for fast code generation and quick tasks.
 *
 * The tool accepts a `prompt` (required) and an optional `model`, runs in the background, and returns a short, truncated result suitable for quick responses.
 *
 * @returns A configured `GeminiTool` named `ask_droid` whose `execute` accepts `{ prompt: string, model?: string }` and returns either:
 * - `{ result: string, durationMs: number, isError: boolean, instruction: string }` on success, or
 * - `{ error: string }` on failure or invalid input.
 */
function createAskDroid(): GeminiTool {
  return {
    name: 'ask_droid',
    description:
      'Run Factory Droid powered by Groq LPU for lightning-fast code generation and quick tasks. Use for writing code snippets, quick scripts, simple questions, or anything that benefits from speed over depth. Runs in the background.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'What you want Droid to do (e.g. "Write a Python hello world").',
        },
        model: {
          type: 'string',
          description: 'Optional model override (default: groq/llama-4-scout).',
        },
      },
      required: ['prompt'],
    },
    behavior: 'NON_BLOCKING',
    execute: async (args) => {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) return { error: 'Prompt is required.' };

      try {
        const result = await execDroidJSON(prompt, {
          model: args.model ? String(args.model) : undefined,
          timeoutMs: 60_000,
        });

        return {
          result: truncate(result.result),
          durationMs: result.durationMs,
          isError: result.isError,
          instruction: result.isError
            ? 'Droid encountered an error. Tell the user what went wrong.'
            : 'Summarize Droid\'s output verbally. Keep it concise.',
        };
      } catch (err: any) {
        return { error: `Droid request failed: ${err.message}` };
      }
    },
  };
}

/**
 * Creates a GeminiTool that runs shell commands on the Linux desktop.
 *
 * @returns A GeminiTool named `run_command` whose `execute` method runs a provided bash command (30-second timeout) and returns an object containing `exit_code`, `stdout`, and `stderr`, or an `error` message on failure.
 */
function createRunCommand(): GeminiTool {
  return {
    name: 'run_command',
    description:
      'Execute a shell command on the Linux desktop. Use for checking system info, file operations, package management, or running scripts. Has a 30-second timeout.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Bash command to execute (e.g. "df -h", "uname -a", "ls ~/Desktop").',
        },
      },
      required: ['command'],
    },
    execute: async (args) => {
      const command = String(args.command || '').trim();
      if (!command) return { error: 'Command is required.' };

      try {
        const { stdout, stderr, exitCode } = await execCommand(command);
        return { exit_code: exitCode, stdout, stderr };
      } catch (err: any) {
        return { error: `Command execution failed: ${err.message}` };
      }
    },
  };
}

/**
 * Create the set of Gemini tools used by the Discord voice agent for a given guild context.
 *
 * @param ctx - Agent context containing the guild identifier and its derived chat id
 * @returns An array of Gemini tools configured for voice-agent operations (memory search, remember, Claude and Droid delegation, and local command execution)
 */

export function createAgentVoiceTools(ctx: AgentToolContext): GeminiTool[] {
  return [
    createSearchMemory(),
    createRemember(),
    createAskClaude(ctx),
    createAskDroid(),
    createRunCommand(),
  ];
}

/**
 * Create an AgentToolContext for a Discord guild.
 *
 * @returns An object containing the provided `guildId` and a deterministic negative `chatId` derived from that `guildId`
 */
export function agentContextFromGuild(guildId: string): AgentToolContext {
  return { guildId, chatId: guildIdToChat(guildId) };
}