# Live Transcript Prototype Design

**Date:** 2026-03-09

## Context

The current dashboard exposes agent activity in structured cards and JSON-heavy detail panes. That is useful for inspection, but it does not feel like the native verbose terminal transcript the operator wants. The first prototype should prove the transcript renderer in isolation before any changes to the existing `Events`, `Tool Calls`, `Fleet`, or `Tasks` surfaces.

## Goals

- Add a new `Live` sandbox tab to the dashboard.
- Render agent activity as a terminal-style transcript instead of cards.
- Preserve the existing dashboard tabs unchanged so rollback is trivial.
- Build the transcript renderer so it can later power agent-scoped Fleet drill-downs and, if successful, an `Events` verbose mode.

## Non-Goals

- Replacing the current `Events` tab in the first pass.
- Reworking the `Tasks` tab as a prototype surface.
- Shipping Fleet drill-downs in the same change.
- Adding a broad new dashboard testing framework.

## Approved Decisions

### 1. Prototype Surface

Add a new `Live` nav tab in the dashboard shell. This is explicitly a sandbox surface, not a replacement for any existing panel. The current `Fleet`, `Events`, `Tool Calls`, `Tasks`, and `Settings` flows remain untouched.

### 2. Transcript-First Experience

The `Live` tab renders a full-width terminal transcript, not a feed of cards. The experience should feel like a native verbose session:

- timestamps in a left gutter
- agent tag per entry
- shell-style command lines with `$`
- search/query entries rendered as readable query blocks
- stdout/stderr as terminal output blocks
- code edits and diffs rendered as readable change blocks
- raw payloads available behind a small `raw` expander

Large outputs should be clamped by default and expanded on demand so the transcript stays readable while live activity is flowing.

### 3. Append-Only Progress Semantics

Progress lines remain in the transcript as historical entries. They are not replaced or deleted when the owning tool completes. Instead, once the tool resolves, prior progress lines for the same tool call are visually downgraded:

- dimmed styling
- resolved marker instead of live animation
- preserved ordering in the timeline

This keeps the transcript auditable while still feeling live during execution.

### 4. Diff Rendering Fallback Order

Diff rendering follows a strict fallback order:

1. Structured edit inputs first. When tool input includes `file_path`, `old_string`, `new_string`, or patch operation data, render a proper edit block with before/after or patch sections.
2. Unified diff text second. When output contains diff-like text, apply lightweight `+`, `-`, and `@@` hunk formatting.
3. Raw fallback last. If neither structured nor diff-like content is available, show the captured payload under `raw`.

This favors rich telemetry already present in tool inputs over fragile diff parsing.

### 5. Three-Layer UI Architecture

The prototype should be split into three clean layers:

1. `apps/dashboard/src/lib/live-transcript.ts`
   Pure mapping logic that folds dashboard events, correlates tool lifecycle, classifies transcript entry kinds, applies scope filtering, and marks progress entries as resolved.
2. `apps/dashboard/src/components/dashboard/live-transcript.tsx`
   Thin orchestration layer that reads store state, applies filters, invokes the mapper, and feeds the result into the virtualized transcript list.
3. `apps/dashboard/src/components/dashboard/transcript-renderers.tsx`
   Dumb renderers per transcript entry kind. These should render pre-classified entries and avoid touching raw dashboard payloads directly.

### 6. Dashboard-Local Helper, Not Cross-App Import

The dashboard should not import `src/telegram/terminal-renderer.ts` directly in the first pass. The current dashboard app boundary only maps `@/*` to `apps/dashboard/src/*`, so cross-app imports would create avoidable build risk.

The first pass should create a dashboard-local helper seeded from the same tool icon/action/detail rule table. That local helper can be deduplicated into a shared pure module later if the pattern proves itself.

### 7. Existing Virtualization Stack

Use the existing `@tanstack/react-virtual` dependency already present in the dashboard workspace. Do not add `react-virtuoso` for the prototype.

### 8. Scope Controls From Day One

The `Live` tab should include lightweight scope controls from the start:

- `All`
- `Nightfox Core`
- `Voice`
- `Droid`
- `Transcribe`

Even if only `Nightfox Core` has rich transcript data on day one, the component contract should support per-agent scope immediately so the future Fleet drill-down can reuse the same renderer rather than fork it.

### 9. Graceful Fallbacks

If the mapper cannot confidently classify an event, the transcript must still show it as a readable generic entry plus an optional `raw` expansion. The prototype must degrade gracefully rather than hiding or dropping data.

## Verification Strategy

Keep verification focused on the pure transcript logic instead of adding a full frontend test stack for the prototype.

The key automated coverage target is the mapper in `apps/dashboard/src/lib/live-transcript.ts`:

- tool lifecycle correlation by `callId` and fallback identity
- progress entries resolving correctly
- structured edit inputs becoming edit/diff entries
- raw diff text receiving `+/-/@@` formatting
- per-agent filters returning the expected subset

UI verification should then rely on:

- dashboard lint
- dashboard build
- manual validation in the `Live` tab using real event traffic

## Future Phases

If the prototype works:

1. Reuse the renderer for Fleet agent drill-downs.
2. Revisit `Events` and decide whether to add a condensed/verbose toggle using the proven transcript renderer.
3. Consider extracting the dashboard-local transcript helper into a shared pure module if the rule table stabilizes.
