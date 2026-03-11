import fs from 'node:fs';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import { getProjectStatePath } from '../utils/app-paths.js';
import type { DashboardEventMap } from './types.js';

type TurnDisposition = 'respond_only' | 'respond_and_execute' | 'respond_and_delegate' | 'waiting_on_user';

export type TurnToolCall = {
  toolName: string;
  callId?: string;
  startedAt: number;
  endedAt?: number;
  status?: 'completed' | 'error';
};

export type TurnExecutionRecord = {
  chatId: number;
  turnStartedAt: number;
  completedAt?: number;
  disposition: TurnDisposition;
  toolCalls: TurnToolCall[];
  delegatedJobIds: string[];
  waitingForUser: boolean;
  responseText?: string;
  error?: string;
};

type ActiveTurn = TurnExecutionRecord;

export type TurnExecutionEvent = {
  chatId: number;
  record: TurnExecutionRecord;
  timestamp: number;
};

export class TurnExecutionLedger {
  private readonly persistPath: string;
  private readonly activeTurns = new Map<number, ActiveTurn>();
  private readonly latestByChat = new Map<number, TurnExecutionRecord>();
  private started = false;

  private readonly onAgentStart = (ev: DashboardEventMap['agent:start']) => {
    const prior = this.activeTurns.get(ev.chatId);
    const waitingForUser = this.detectWaitingForUser(ev.prompt);
    const record: ActiveTurn = {
      chatId: ev.chatId,
      turnStartedAt: ev.timestamp,
      disposition: waitingForUser ? 'waiting_on_user' : 'respond_only',
      toolCalls: [],
      delegatedJobIds: [],
      waitingForUser,
    };
    this.activeTurns.set(ev.chatId, record);
    if (prior?.completedAt) {
      this.latestByChat.set(ev.chatId, prior);
    }
  };

  private readonly onToolStart = (ev: DashboardEventMap['agent:tool_start']) => {
    const turn = this.ensureActiveTurn(ev.chatId, ev.timestamp);
    turn.toolCalls.push({
      toolName: ev.toolName,
      callId: ev.callId,
      startedAt: ev.timestamp,
    });
    turn.disposition = turn.delegatedJobIds.length > 0 ? 'respond_and_delegate' : 'respond_and_execute';
    this.persist();
  };

  private readonly onToolEnd = (ev: DashboardEventMap['agent:tool_end']) => {
    const turn = this.ensureActiveTurn(ev.chatId, ev.timestamp);
    const target = [...turn.toolCalls].reverse().find((call) => {
      if (ev.callId && call.callId) return call.callId === ev.callId;
      return !call.endedAt && call.toolName === ev.toolName && Math.abs(ev.timestamp - call.startedAt) <= 60_000;
    });
    if (target) {
      target.endedAt = ev.timestamp;
      target.status = ev.status;
    }
    this.persist();
  };

  private readonly onAgentComplete = (ev: DashboardEventMap['agent:complete']) => {
    const turn = this.ensureActiveTurn(ev.chatId, ev.timestamp);
    turn.completedAt = ev.timestamp;
    turn.responseText = ev.text;
    turn.disposition = this.finalDisposition(turn);
    this.finalize(turn);
  };

  private readonly onAgentError = (ev: DashboardEventMap['agent:error']) => {
    const turn = this.ensureActiveTurn(ev.chatId, ev.timestamp);
    turn.error = ev.error;
    turn.completedAt = ev.timestamp;
    turn.disposition = this.finalDisposition(turn);
    this.finalize(turn);
  };

  private readonly onJobQueued = (ev: DashboardEventMap['job:queued']) => {
    const parentChatId = ev.returnRoute?.parentChatId;
    if (typeof parentChatId !== 'number') return;
    const turn = this.ensureActiveTurn(parentChatId, ev.at);
    if (!turn.delegatedJobIds.includes(ev.jobId)) {
      turn.delegatedJobIds.push(ev.jobId);
    }
    turn.disposition = 'respond_and_delegate';
    this.persist();
  };

  constructor(repoRoot: string = process.cwd()) {
    this.persistPath = getProjectStatePath(repoRoot, 'dashboard', 'turn-execution.json');
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    this.load();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    eventBus.on('agent:start', this.onAgentStart);
    eventBus.on('agent:tool_start', this.onToolStart);
    eventBus.on('agent:tool_end', this.onToolEnd);
    eventBus.on('agent:complete', this.onAgentComplete);
    eventBus.on('agent:error', this.onAgentError);
    eventBus.on('job:queued', this.onJobQueued);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    eventBus.off('agent:start', this.onAgentStart);
    eventBus.off('agent:tool_start', this.onToolStart);
    eventBus.off('agent:tool_end', this.onToolEnd);
    eventBus.off('agent:complete', this.onAgentComplete);
    eventBus.off('agent:error', this.onAgentError);
    eventBus.off('job:queued', this.onJobQueued);
  }

  getLatest(chatId: number): TurnExecutionRecord | undefined {
    const active = this.activeTurns.get(chatId);
    if (active) return this.clone(active);
    const latest = this.latestByChat.get(chatId);
    return latest ? this.clone(latest) : undefined;
  }

  private ensureActiveTurn(chatId: number, timestamp: number): ActiveTurn {
    const existing = this.activeTurns.get(chatId);
    if (existing) return existing;
    const created: ActiveTurn = {
      chatId,
      turnStartedAt: timestamp,
      disposition: 'respond_only',
      toolCalls: [],
      delegatedJobIds: [],
      waitingForUser: false,
    };
    this.activeTurns.set(chatId, created);
    return created;
  }

  private finalize(turn: ActiveTurn): void {
    const frozen = this.clone(turn);
    this.latestByChat.set(turn.chatId, frozen);
    this.activeTurns.delete(turn.chatId);
    this.persist();
    eventBus.emit('turn:execution', {
      chatId: turn.chatId,
      record: frozen,
      timestamp: turn.completedAt ?? Date.now(),
    });
  }

  private finalDisposition(turn: ActiveTurn): TurnDisposition {
    if (turn.waitingForUser) return 'waiting_on_user';
    if (turn.delegatedJobIds.length > 0) return 'respond_and_delegate';
    if (turn.toolCalls.length > 0) return 'respond_and_execute';
    return 'respond_only';
  }

  private detectWaitingForUser(prompt: string): boolean {
    const text = prompt.toLowerCase();
    return text.includes('need your approval') || text.includes('waiting for your input') || text.includes('need your decision');
  }

  private load(): void {
    if (!fs.existsSync(this.persistPath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath, 'utf8')) as {
        latestByChat?: Record<string, TurnExecutionRecord>;
      };
      this.latestByChat.clear();
      for (const [chatId, record] of Object.entries(raw.latestByChat ?? {})) {
        const id = Number(chatId);
        if (Number.isFinite(id) && record) this.latestByChat.set(id, record);
      }
    } catch (error) {
      console.warn(`[TurnExecutionLedger] Failed to load persisted state from ${this.persistPath}; clearing cached records.`, error);
      this.latestByChat.clear();
    }
  }

  private persist(): void {
    const latestByChat = Object.fromEntries(
      [...this.latestByChat.entries()].map(([chatId, record]) => [String(chatId), record]),
    );
    fs.writeFileSync(this.persistPath, JSON.stringify({ latestByChat }, null, 2));
  }

  private clone(record: TurnExecutionRecord): TurnExecutionRecord {
    return structuredClone(record);
  }
}

export const turnExecutionLedger = new TurnExecutionLedger();
