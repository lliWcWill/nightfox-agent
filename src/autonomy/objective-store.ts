import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getProjectStatePath } from '../utils/app-paths.js';
import type { JobPlatform, JobReturnRoute } from '../jobs/core/job-types.js';

export type ObjectiveState = 'active' | 'waiting' | 'completed' | 'canceled' | 'failed';
export type ObjectiveMode = 'manual' | 'autonomous';

const TERMINAL_STATES = new Set<ObjectiveState>(['completed', 'canceled', 'failed']);
const LEGAL_TRANSITIONS: Record<ObjectiveState, ReadonlySet<ObjectiveState>> = {
  active: new Set(['waiting', 'completed', 'canceled', 'failed']),
  waiting: new Set(['active', 'completed', 'canceled', 'failed']),
  completed: new Set(),
  canceled: new Set(),
  failed: new Set(),
};

export type ObjectiveRecord = {
  objectiveId: string;
  revision: number;
  chatId: number;
  platform: JobPlatform;
  channelId: string;
  threadId?: string;
  guildId?: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  state: ObjectiveState;
  mode: ObjectiveMode;
  summary: string;
  successCriteria?: string[];
  nextActions: string[];
  parentJobId?: string;
  childJobIds: string[];
  returnRoute?: JobReturnRoute;
  lastChildJobId?: string;
  lastChildState?: string;
  lastResultSummary?: string;
  wakeAt?: number;
  budget?: {
    maxAutonomyMinutes?: number;
    maxFollowups?: number;
    maxDelegations?: number;
  };
};

type CreateObjectiveInput = {
  chatId: number;
  platform: JobPlatform;
  channelId: string;
  threadId?: string;
  guildId?: string;
  userId: string;
  summary: string;
  nextActions?: string[];
  parentJobId?: string;
  childJobIds?: string[];
  returnRoute?: JobReturnRoute;
  budget?: ObjectiveRecord['budget'];
};

export class ObjectiveStore {
  private readonly persistPath: string;
  private objectives = new Map<string, ObjectiveRecord>();

  constructor(repoRoot: string) {
    this.persistPath = getProjectStatePath(repoRoot, 'autonomy', 'objectives.json');
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    this.load();
  }

  private load() {
    if (!fs.existsSync(this.persistPath)) return;
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const parsed = JSON.parse(raw) as ObjectiveRecord[];
      this.objectives = new Map(parsed.map((o) => [o.objectiveId, o]));
    } catch {
      this.objectives = new Map();
    }
  }

  private persist() {
    fs.writeFileSync(this.persistPath, JSON.stringify(Array.from(this.objectives.values()), null, 2));
  }

  create(input: CreateObjectiveInput): ObjectiveRecord {
    const now = Date.now();
    const record: ObjectiveRecord = {
      objectiveId: crypto.randomUUID(),
      revision: 0,
      chatId: input.chatId,
      platform: input.platform,
      channelId: input.channelId,
      threadId: input.threadId,
      guildId: input.guildId,
      userId: input.userId,
      createdAt: now,
      updatedAt: now,
      state: 'active',
      mode: 'autonomous',
      summary: input.summary,
      nextActions: input.nextActions ?? [],
      parentJobId: input.parentJobId,
      childJobIds: input.childJobIds ?? [],
      returnRoute: input.returnRoute,
      budget: input.budget,
    };
    this.objectives.set(record.objectiveId, record);
    this.persist();
    return record;
  }

  transition(objectiveId: string, nextState: ObjectiveState, patch: Partial<ObjectiveRecord> = {}) {
    const current = this.objectives.get(objectiveId);
    if (!current) return null;
    if (TERMINAL_STATES.has(current.state)) return current;
    if (!LEGAL_TRANSITIONS[current.state].has(nextState) && current.state !== nextState) {
      return current;
    }
    const next: ObjectiveRecord = {
      ...current,
      ...patch,
      state: nextState,
      revision: current.revision + 1,
      updatedAt: Date.now(),
    };
    this.objectives.set(objectiveId, next);
    this.persist();
    return next;
  }

  requestCancel(objectiveId: string, reason = 'user-requested') {
    return this.transition(objectiveId, 'canceled', {
      nextActions: ['Do not send completion update; objective was canceled.'],
      lastChildState: reason,
    });
  }

  markDelivery(objectiveId: string, summary: string) {
    const current = this.objectives.get(objectiveId);
    if (!current) return null;
    const next: ObjectiveRecord = {
      ...current,
      revision: current.revision + 1,
      updatedAt: Date.now(),
      lastResultSummary: summary,
    };
    this.objectives.set(objectiveId, next);
    this.persist();
    return next;
  }

  get(objectiveId: string) {
    return this.objectives.get(objectiveId);
  }

  list() {
    return Array.from(this.objectives.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  update(objectiveId: string, patch: Partial<ObjectiveRecord>) {
    const current = this.objectives.get(objectiveId);
    if (!current) return null;
    if (TERMINAL_STATES.has(current.state) && patch.state && patch.state !== current.state) {
      return current;
    }
    const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: Date.now() };
    this.objectives.set(objectiveId, next);
    this.persist();
    return next;
  }

  findByChildJobId(jobId: string) {
    return this.list().find((o) => o.childJobIds.includes(jobId));
  }

  addChildJob(objectiveId: string, jobId: string) {
    const current = this.objectives.get(objectiveId);
    if (!current) return null;
    if (!current.childJobIds.includes(jobId)) current.childJobIds.push(jobId);
    current.updatedAt = Date.now();
    this.objectives.set(objectiveId, current);
    this.persist();
    return current;
  }
}
