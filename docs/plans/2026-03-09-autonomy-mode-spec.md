# Nightfox Autonomy Mode Spec

## Goal
After replying to the user, Nightfox should be able to remain active on an objective, monitor delegated work, perform bounded follow-up actions, and proactively report back when there is meaningful progress or completion.

## Baseline inspiration from clawdbot-ref
Key patterns to copy:
- durable child-run registry
- explicit completion capture
- explicit delivery target / thread affinity
- push-based completion handling instead of polling-only UX
- clear separation between spawn, completion capture, and announce delivery

## Product definition
Autonomy Mode is a bounded runtime mode where the assistant can continue working after a user-facing reply if:
- there is an active objective
- there are delegated/background jobs in flight, or
- a follow-up check/research action was explicitly scheduled

Autonomy Mode must always be:
- stoppable
- visible
- budgeted
- scoped to a session/thread

## Core user-visible behavior
When autonomy mode is active:
1. assistant replies normally
2. assistant remains attached to the objective
3. assistant monitors child jobs/results/dashboard events
4. assistant may perform bounded follow-up actions
5. assistant proactively posts updates or final results
6. user can stop it from Discord or dashboard

## Required primitives

### 1. Objective record
Add persisted objective records keyed by session/thread.

```ts
type ObjectiveRecord = {
  objectiveId: string;
  chatId: number;
  platform: 'discord' | 'telegram';
  channelId: string;
  threadId?: string;
  guildId?: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  state: 'active' | 'waiting' | 'completed' | 'canceled' | 'failed';
  mode: 'manual' | 'autonomous';
  summary: string;
  successCriteria?: string[];
  nextActions: string[];
  parentJobId?: string;
  childJobIds: string[];
  returnRoute?: JobReturnRoute;
  wakeAt?: number;
  budget?: {
    maxAutonomyMinutes?: number;
    maxFollowups?: number;
    maxDelegations?: number;
  };
};
```

### 2. Autonomy scheduler
Add a lightweight scheduler that wakes active objectives when:
- a child job ends
- a dashboard event arrives
- wakeAt is reached
- a retryable delivery failure needs retry

Suggested file:
- `src/autonomy/autonomy-scheduler.ts`

Responsibilities:
- maintain wake queue
- debounce duplicate wakeups
- enforce budgets
- call autonomy runner

### 3. Autonomy runner
Suggested file:
- `src/autonomy/autonomy-runner.ts`

Responsibilities:
- inspect objective state
- inspect child job state/results
- decide next action:
  - no-op / wait
  - summarize child completion
  - perform bounded follow-up research
  - send final answer
- persist updated objective state

### 4. Return-route based callback delivery
Already partially underway. Final target:
- objective owns canonical return route
- delegated jobs inherit return route
- completion delivery uses return route first-class
- failed delivery goes to retry/outbox

### 5. Unified cancellation
Autonomy mode must stop through one coordinator.

Suggested file:
- `src/cancel/cancellation-coordinator.ts`

Methods:
- `cancelChat(chatId)`
- `cancelObjective(objectiveId)`
- `cancelJob(jobId)`
- `cancelJobTree(rootJobId)`
- `cancelOrigin(origin)`

Cancellation must propagate to:
- request queue
- active provider streams
- jobRunner jobs
- autonomy scheduler wakeups

## Data model additions

### JobSnapshot / Objective linkage
Add optional objective linkage to jobs:

```ts
type JobSnapshot = {
  ...
  objectiveId?: string;
};
```

### Objective events
Emit events:
- `objective:created`
- `objective:wake`
- `objective:progress`
- `objective:waiting`
- `objective:completed`
- `objective:canceled`
- `objective:error`

## Dashboard/API additions

### REST
- `GET /api/objectives`
- `GET /api/objectives/:id`
- `POST /api/objectives/:id/stop`
- `POST /api/objectives/:id/wake`
- `GET /api/jobs/:id/result`
- `GET /api/jobs/:id/logs?cursor=&limit=`
- `POST /api/jobs/:id/cancel`

### WebSocket
Add objective events and per-session/per-objective subscriptions.
Minimum hardening:
- heartbeat
- sequence IDs
- replay cursor

## Discord UX

### Commands
- `/autonomy on`
- `/autonomy off`
- `/cancel` should cancel both live response and autonomy work for current session

### Delivery style
Autonomous follow-ups should be concise and clearly framed, e.g.:
- "Quick update: the delegated task finished; here’s the result..."
- avoid spamming low-value heartbeat messages

## Initial implementation phases

### Phase 1: Minimal viable autonomy
- persist ObjectiveRecord
- create objective when launching delegated work from chat
- wake on child job completion
- synthesize/post result back automatically
- support stop/cancel for objective

### Phase 2: Scheduled follow-ups
- allow wakeAt scheduling
- allow one bounded follow-up tool/research action after child completion
- persist nextActions

### Phase 3: Rich autonomy
- multi-step objective planning
- retry/outbox delivery
- dashboard controls
- richer logs/events

## Immediate code plan
1. Add `src/autonomy/objective-store.ts`
2. Add `src/autonomy/autonomy-scheduler.ts`
3. Add `src/autonomy/autonomy-runner.ts`
4. Create objective on delegated job launch in `src/providers/openai-tools.ts`
5. Wake scheduler from `job-notifier.ts` / job events on completion
6. Add cancel coordinator and route `/cancel` through it
7. Add dashboard stop APIs

## Guardrails
- default autonomy budget: 15 minutes
- max follow-up actions: 3
- max delegated depth remains bounded
- no unbounded self-delegation
- all autonomy state must be visible in dashboard
- every autonomous action must be tied to a session/thread return route

## Why this is the right shape
This copies the strongest ideas from clawdbot-ref:
- durable run state
- explicit routing truth
- completion-driven continuation

But adapts them to Nightfox’s job runner / dashboard architecture instead of forcing a full rewrite.
