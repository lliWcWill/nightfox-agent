import fs from 'node:fs';
import path from 'node:path';
import { getProjectStatePath } from '../utils/app-paths.js';
import type { ObjectiveRecord, ObjectiveState } from './objective-store.js';

export type ObjectiveEventType =
  | 'objective:created'
  | 'objective:state'
  | 'objective:child-linked'
  | 'objective:child-completed'
  | 'objective:delivery-ready'
  | 'objective:delivery-sent'
  | 'objective:delivery-skipped'
  | 'objective:cancel-requested';

export type ObjectiveEvent = {
  objectiveId: string;
  type: ObjectiveEventType;
  at: number;
  state?: ObjectiveState;
  childJobId?: string;
  summary?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export class ObjectiveEventStore {
  private readonly persistPath: string;
  private readonly maxEventsPerObjective: number;
  private readonly eventsByObjective = new Map<string, ObjectiveEvent[]>();

  constructor(repoRoot: string, maxEventsPerObjective = 200) {
    this.persistPath = getProjectStatePath(repoRoot, 'autonomy', 'objective-events.json');
    this.maxEventsPerObjective = maxEventsPerObjective;
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    this.load();
  }

  private load() {
    if (!fs.existsSync(this.persistPath)) return;
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, ObjectiveEvent[]>;
      this.eventsByObjective.clear();
      for (const [objectiveId, events] of Object.entries(parsed ?? {})) {
        if (!Array.isArray(events)) continue;
        this.eventsByObjective.set(objectiveId, events);
      }
    } catch {
      this.eventsByObjective.clear();
    }
  }

  private persist() {
    const serializable = Object.fromEntries(this.eventsByObjective.entries());
    fs.writeFileSync(this.persistPath, JSON.stringify(serializable, null, 2));
  }

  append(event: ObjectiveEvent) {
    const current = this.eventsByObjective.get(event.objectiveId) ?? [];
    current.push(event);
    if (current.length > this.maxEventsPerObjective) {
      current.splice(0, current.length - this.maxEventsPerObjective);
    }
    this.eventsByObjective.set(event.objectiveId, current);
    this.persist();
    return event;
  }

  list(objectiveId: string) {
    return [...(this.eventsByObjective.get(objectiveId) ?? [])];
  }

  page(objectiveId: string, cursor = 0, limit = 200) {
    const events = this.eventsByObjective.get(objectiveId) ?? [];
    const safeCursor = Math.max(0, Math.min(cursor, events.length));
    const safeLimit = Math.max(1, Math.min(limit, this.maxEventsPerObjective));
    const slice = events.slice(safeCursor, safeCursor + safeLimit);
    const nextCursor = safeCursor + slice.length;
    return {
      total: events.length,
      cursor: safeCursor,
      nextCursor,
      hasMore: nextCursor < events.length,
      events: slice,
    };
  }

  recordCreated(objective: ObjectiveRecord) {
    return this.append({
      objectiveId: objective.objectiveId,
      type: 'objective:created',
      at: objective.createdAt,
      state: objective.state,
      summary: objective.summary,
    });
  }
}
