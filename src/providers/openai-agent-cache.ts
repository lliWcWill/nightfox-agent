/**
 * Per-chat Agent lifecycle cache for the OpenAI Agents SDK.
 *
 * Each chat gets its own Agent instance. The cache invalidates when the model
 * or working directory changes, creating a fresh Agent with updated config.
 * Tracks previousResponseId for server-side multi-turn continuity.
 */

import { Agent } from '@openai/agents';

import { getSystemPrompt } from './system-prompt.js';
import { createFsuiteTools } from './openai-tools.js';
import type { Platform } from './types.js';

interface ChatAgentState {
  agent: Agent;
  model: string;
  cwd: string;
  lastResponseId: string | undefined;
  turnCount: number;
}

export class AgentCache {
  private readonly cache = new Map<number, ChatAgentState>();

  /**
   * Returns an existing Agent for the chat, or creates a new one.
   * Invalidates if model or cwd changed since last creation.
   */
  getOrCreate(
    chatId: number,
    model: string,
    cwd: string,
    platform: Platform = 'telegram',
  ): ChatAgentState {
    const existing = this.cache.get(chatId);

    if (existing && existing.model === model && existing.cwd === cwd) {
      return existing;
    }

    // Create fresh Agent with fsuite tools scoped to cwd
    const tools = createFsuiteTools(cwd);
    const agent = new Agent({
      name: 'claudegram-openai',
      instructions: getSystemPrompt(platform),
      model,
      tools,
    });

    const state: ChatAgentState = {
      agent,
      model,
      cwd,
      lastResponseId: undefined,
      turnCount: 0,
    };

    this.cache.set(chatId, state);
    return state;
  }

  /** Update the previousResponseId after a successful run. */
  setLastResponseId(chatId: number, responseId: string | undefined): void {
    const state = this.cache.get(chatId);
    if (state) {
      state.lastResponseId = responseId;
    }
  }

  /** Increment and return the new turn count. */
  incrementTurn(chatId: number): number {
    const state = this.cache.get(chatId);
    if (state) {
      state.turnCount += 1;
      return state.turnCount;
    }
    return 1;
  }

  /** Get the current turn count for a chat. */
  getTurnCount(chatId: number): number {
    return this.cache.get(chatId)?.turnCount ?? 0;
  }

  /** Get the last response ID for multi-turn continuity. */
  getLastResponseId(chatId: number): string | undefined {
    return this.cache.get(chatId)?.lastResponseId;
  }

  /** Remove a chat's cached state entirely (used by /clear). */
  delete(chatId: number): void {
    this.cache.delete(chatId);
  }

  /** Clear only the response chain (used by /clear without destroying Agent). */
  clearResponseId(chatId: number): void {
    const state = this.cache.get(chatId);
    if (state) {
      state.lastResponseId = undefined;
      state.turnCount = 0;
    }
  }

  /** Get the Agent instance for a chat (used for hook matching). */
  getAgent(chatId: number): Agent | undefined {
    return this.cache.get(chatId)?.agent;
  }

  /** Check if a chat has a cached agent. */
  has(chatId: number): boolean {
    return this.cache.has(chatId);
  }
}
