# Live Transcript Prototype Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an isolated `Live` dashboard tab that renders agent activity as a reusable terminal-style transcript without changing the existing `Events`, `Tool Calls`, `Fleet`, or `Tasks` behavior.

**Architecture:** Keep the feature client-side. Fold the existing dashboard store data into typed transcript entries in a pure mapper module, render those entries through small renderer components, and wire the prototype into a new `Live` panel in the dashboard shell. Keep tool classification local to the dashboard workspace and preserve future reuse for agent-scoped Fleet drill-downs.

**Tech Stack:** Next.js 16, React 19, Zustand, Motion, Tailwind CSS, `@tanstack/react-virtual`, Node test runner with `tsx`

---

### Task 1: Transcript Domain And Pure Mapper

**Files:**
- Create: `apps/dashboard/src/lib/live-transcript.ts`
- Create: `apps/dashboard/src/lib/live-transcript.test.ts`
- Modify: `apps/dashboard/src/lib/types.ts`
- Reference: `src/telegram/terminal-renderer.ts`

**Step 1: Write the failing test**

Create a focused Node test file that proves the mapper contract before any UI exists.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveTranscript } from "./live-transcript";
import type { DashboardEvent, ToolCallInfo } from "./types";

test("buildLiveTranscript correlates tool lifecycle, resolves progress, and classifies diffs", () => {
  const events: DashboardEvent[] = [
    {
      id: "start-1",
      type: "agent:tool_start",
      timestamp: 1000,
      payload: {
        chatId: 7,
        callId: "call_1",
        toolName: "shell",
        input: { commands: ["git diff --stat"] },
      },
    },
    {
      id: "progress-1",
      type: "agent:progress",
      timestamp: 1100,
      payload: { chatId: 7, text: "running git diff" },
    },
    {
      id: "end-1",
      type: "agent:tool_end",
      timestamp: 1200,
      payload: {
        chatId: 7,
        callId: "call_1",
        toolName: "shell",
        output: [{ stdout: "@@\\n+added\\n-removed", stderr: "", exitCode: 0 }],
      },
    },
  ];

  const toolCalls: ToolCallInfo[] = [
    {
      id: "tool-1",
      chatId: 7,
      callId: "call_1",
      toolName: "shell",
      input: { commands: ["git diff --stat"] },
      output: [{ stdout: "@@\\n+added\\n-removed", stderr: "", exitCode: 0 }],
      status: "completed",
      startedAt: 1000,
      completedAt: 1200,
    },
  ];

  const transcript = buildLiveTranscript({
    events,
    toolCalls,
    scope: "all",
  });

  assert.equal(transcript.some((entry) => entry.kind === "command"), true);
  assert.equal(
    transcript.some((entry) => entry.kind === "progress" && entry.resolved === true),
    true
  );
  assert.equal(transcript.some((entry) => entry.kind === "diff"), true);
});
```

Add a second test covering structured edits:

```ts
test("buildLiveTranscript prefers structured edit input over raw diff parsing", () => {
  const transcript = buildLiveTranscript({
    events: [
      {
        id: "edit-1",
        type: "agent:tool_start",
        timestamp: 2000,
        payload: {
          chatId: 7,
          callId: "call_edit",
          toolName: "Edit",
          input: {
            file_path: "apps/dashboard/src/components/dashboard/shell.tsx",
            old_string: "old",
            new_string: "new",
          },
        },
      },
    ],
    toolCalls: [],
    scope: "all",
  });

  const editEntry = transcript.find((entry) => entry.kind === "edit");
  assert.ok(editEntry);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/dashboard/src/lib/live-transcript.test.ts`

Expected: FAIL with `Cannot find module './live-transcript'` or missing export errors.

**Step 3: Write minimal implementation**

Create the transcript types and mapper with a local rule table seeded from `src/telegram/terminal-renderer.ts`.

```ts
export type LiveScope = "all" | "claude" | "gemini" | "droid" | "groq";

export type TranscriptEntry =
  | { id: string; kind: "session"; timestamp: number; agentId: LiveScope; label: string }
  | { id: string; kind: "command"; timestamp: number; agentId: LiveScope; text: string }
  | { id: string; kind: "progress"; timestamp: number; agentId: LiveScope; text: string; resolved: boolean }
  | { id: string; kind: "stdout"; timestamp: number; agentId: LiveScope; text: string }
  | { id: string; kind: "stderr"; timestamp: number; agentId: LiveScope; text: string }
  | { id: string; kind: "diff"; timestamp: number; agentId: LiveScope; text: string }
  | { id: string; kind: "edit"; timestamp: number; agentId: LiveScope; filePath: string; oldText: string; newText: string }
  | { id: string; kind: "raw"; timestamp: number; agentId: LiveScope; value: unknown };

export function buildLiveTranscript(input: {
  events: DashboardEvent[];
  toolCalls: ToolCallInfo[];
  scope: LiveScope;
}): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const resolvedCalls = new Set(
    input.toolCalls.filter((tool) => tool.status !== "running").map((tool) => tool.callId ?? tool.id)
  );

  for (const event of input.events) {
    // classify event, infer agent, and emit typed transcript entries
  }

  return input.scope === "all"
    ? entries
    : entries.filter((entry) => entry.agentId === input.scope);
}
```

Update `apps/dashboard/src/lib/types.ts` with a typed dashboard panel ID union if needed so the new panel is not just a stringly-typed addition.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/dashboard/src/lib/live-transcript.test.ts`

Expected: PASS with both transcript mapper tests green.

**Step 5: Commit**

```bash
git add apps/dashboard/src/lib/live-transcript.ts apps/dashboard/src/lib/live-transcript.test.ts apps/dashboard/src/lib/types.ts
git commit -m "feat: add live transcript mapper"
```

### Task 2: Transcript Renderers And Virtualized Panel

**Files:**
- Create: `apps/dashboard/src/components/dashboard/live-transcript.tsx`
- Create: `apps/dashboard/src/components/dashboard/transcript-renderers.tsx`
- Modify: `apps/dashboard/src/lib/live-transcript.ts`
- Test: `apps/dashboard/src/lib/live-transcript.test.ts`

**Step 1: Write the failing test**

Extend the mapper test so the renderer contract exists before the component code:

```ts
test("buildLiveTranscript emits agent-scoped entries and clamped output metadata", () => {
  const transcript = buildLiveTranscript({
    events: [
      {
        id: "voice-1",
        type: "voice:text",
        timestamp: 3000,
        payload: { guildId: "g1", text: "hello" },
      },
    ],
    toolCalls: [],
    scope: "gemini",
  });

  assert.equal(transcript.every((entry) => entry.agentId === "gemini"), true);
});
```

If you model clamping metadata in the entry shape, assert that long output emits a `collapsed: true` or `truncated: true` flag here too.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/dashboard/src/lib/live-transcript.test.ts`

Expected: FAIL because scope filtering or output metadata is missing from the mapper contract.

**Step 3: Write minimal implementation**

Add the virtualized `LiveTranscript` panel and dumb renderers.

```tsx
export function LiveTranscript() {
  const events = useDashboardStore((s) => s.events);
  const toolCalls = useDashboardStore((s) => s.toolCalls);
  const liveScope = useDashboardStore((s) => s.liveScope);
  const setLiveScope = useDashboardStore((s) => s.setLiveScope);

  const entries = useMemo(
    () => buildLiveTranscript({ events, toolCalls, scope: liveScope }),
    [events, toolCalls, liveScope]
  );

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  return (
    <GlassPanel className="h-full min-h-0">
      <LiveScopeControls value={liveScope} onChange={setLiveScope} />
      <TranscriptViewport entries={entries} rowVirtualizer={rowVirtualizer} />
    </GlassPanel>
  );
}
```

Keep `transcript-renderers.tsx` dumb:

```tsx
export function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  switch (entry.kind) {
    case "command":
      return <CommandLine entry={entry} />;
    case "diff":
      return <DiffBlock entry={entry} />;
    case "edit":
      return <EditBlock entry={entry} />;
    default:
      return <GenericLine entry={entry} />;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/dashboard/src/lib/live-transcript.test.ts`

Expected: PASS with the expanded mapper contract still green.

Then run: `npm run dashboard:lint`

Expected: PASS with no new lint failures in the new transcript files.

**Step 5: Commit**

```bash
git add apps/dashboard/src/components/dashboard/live-transcript.tsx apps/dashboard/src/components/dashboard/transcript-renderers.tsx apps/dashboard/src/lib/live-transcript.ts apps/dashboard/src/lib/live-transcript.test.ts
git commit -m "feat: add live transcript panel"
```

### Task 3: Shell Wiring, Store State, And Live Tab Verification

**Files:**
- Modify: `apps/dashboard/src/components/dashboard/shell.tsx:25-30`
- Modify: `apps/dashboard/src/components/dashboard/shell.tsx:197-239`
- Modify: `apps/dashboard/src/hooks/use-store.ts:124-134`
- Modify: `apps/dashboard/src/hooks/use-store.ts:251-261`
- Modify: `apps/dashboard/src/lib/types.ts`
- Reference: `apps/dashboard/src/components/dashboard/action-log.tsx`

**Step 1: Write the failing test**

Add one more mapper/store-facing test that proves the final panel contract can scope correctly for future Fleet reuse:

```ts
test("buildLiveTranscript returns only claude entries for claude scope", () => {
  const transcript = buildLiveTranscript({
    events: [
      {
        id: "claude-1",
        type: "agent:start",
        timestamp: 4000,
        payload: { chatId: 7, model: "gpt-5.4", prompt: "hi" },
      },
      {
        id: "voice-2",
        type: "voice:text",
        timestamp: 4100,
        payload: { guildId: "g1", text: "hello" },
      },
    ],
    toolCalls: [],
    scope: "claude",
  });

  assert.equal(transcript.every((entry) => entry.agentId === "claude"), true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/dashboard/src/lib/live-transcript.test.ts`

Expected: FAIL if scope inference is still incorrect or incomplete.

**Step 3: Write minimal implementation**

Wire the new panel into the dashboard shell and store.

```ts
type DashboardPanel = "fleet" | "log" | "tools" | "live" | "tasks" | "settings";
type LiveScope = "all" | "claude" | "gemini" | "droid" | "groq";

interface DashboardState {
  activePanel: DashboardPanel;
  setActivePanel: (panel: DashboardPanel) => void;
  liveScope: LiveScope;
  setLiveScope: (scope: LiveScope) => void;
}
```

Then update the shell nav:

```tsx
const NAV_ITEMS = [
  { id: "fleet", icon: Radio, label: "Fleet" },
  { id: "log", icon: Activity, label: "Events" },
  { id: "tools", icon: Terminal, label: "Tool Calls" },
  { id: "live", icon: TerminalSquare, label: "Live" },
  { id: "tasks", icon: Kanban, label: "Tasks" },
  { id: "settings", icon: Settings, label: "Settings" },
];
```

Render the panel without changing the other views:

```tsx
{activePanel === "live" && <LiveTranscript />}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/dashboard/src/lib/live-transcript.test.ts`

Expected: PASS with all scope tests green.

Then run: `npm run dashboard:lint`

Expected: PASS.

Then run: `npm run dashboard:build`

Expected: PASS and produce a successful Next.js build for the dashboard workspace.

Finally, manually verify:

1. Open the dashboard.
2. Click `Live`.
3. Confirm existing tabs still render exactly as before.
4. Trigger real agent activity and confirm the transcript updates live, clamps large blocks, exposes `raw`, and respects scope controls.

**Step 5: Commit**

```bash
git add apps/dashboard/src/components/dashboard/shell.tsx apps/dashboard/src/hooks/use-store.ts apps/dashboard/src/lib/types.ts
git commit -m "feat: wire live transcript prototype"
```
