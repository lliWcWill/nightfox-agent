# OpenAI Codex OAuth Runbook (Nightfox)

## Purpose
Prevent repeat regressions in the OpenAI OAuth + Codex path, especially after refactors.

## Incident Summary
- Symptom in Discord voice flow: `OpenAI error: 400` or `401 status code (no body)`.
- Transcription succeeded; failure happened in the OpenAI Responses call.
- Initial regression found: request `input` was changed from message-list to a single string transcript.
- Important: that fix alone was not sufficient. We still saw failures until we matched OpenClaw's Codex tool/request model.

## Confirmed Codex Backend Requirements
For `https://chatgpt.com/backend-api/codex/responses`:
1. `instructions` is required.
2. `stream` must be `true`.
3. `input` must be a list (message items), not a plain string transcript.
4. `store` should be `false` for this path.
5. Include `chatgpt-account-id` header with OAuth token auth.
6. Include `OpenAI-Beta: responses=experimental`.
7. Function tools are safest in Codex mode; avoid relying on OpenAI built-in tool types for dangerous local tools.

## What We Thought First (Partial Fix)
- Regression location: `src/providers/openai-provider.ts`
- Bad behavior: `buildInput()` returned a single string transcript.
- Partial fix: `buildInput()` now returns `AgentInputItem[]` using `user(...)` / `assistant(...)`.
- Result: improved compatibility, but failures still reproduced intermittently (voice/tool flows).

## Actual Resolution (After Deep OpenClaw Reference)
After comparing architecture with `Desktop/Projects/clawdbot-ref`, the durable fix was a bundle, not one change:
1. Keep list-based `input` (`AgentInputItem[]`) and local history replay.
2. Replace dangerous built-ins with custom function tools:
   - moved from built-in `shellTool`/`applyPatchTool` to function tools (`shell`/`exec`, `write`, `edit`, `apply_patch`).
3. Shape Codex OAuth requests correctly in `src/providers/openai-auth.ts`:
   - `baseURL=https://chatgpt.com/backend-api/codex`
   - headers include `chatgpt-account-id`, `OpenAI-Beta: responses=experimental`, `originator: pi`
   - force `store=false` only on responses/completions paths.
4. Harden tool behavior (sensitive path guards, shell bounds, diff validation), so retries don't spiral due to malformed tool actions.

Relevant commit chain:
- `4245827` — list-based input for Codex compatibility
- `48b6575` — function-tool parity + OAuth request shaping
- `e6f1594` — hardening (sensitive file guardrails, clamping, diff correctness)
- `3741290` — endpoint match + diff validation refinements

## Non-Negotiable Refactor Guardrails
When touching OpenAI provider code:
1. Do not convert multi-turn history into one long string for Codex.
2. Keep structured message items for `run()`.
3. Keep stream mode enabled for responses calls.
4. Keep `instructions` present in system prompt path.
5. Prefer custom function tools for dangerous local actions in Codex mode.
6. Re-check dist runtime behavior (`systemd` runs `dist/discord-index.js`, not `src`).

## Fast Triage Checklist (Use in Order)
1. Verify auth mode and model in logs.
2. Verify request-shape assumptions:
   - `input` list
   - `stream: true`
   - `instructions` present
3. Probe Codex endpoint directly with curl and current token/header.
4. If direct curl works but SDK path fails, inspect wrapper/serialization layer.
5. Rebuild + restart service after code changes.

## Memory Crawl Protocol (Broad -> Narrow)
Agents must not start memory search with long sentence queries.

### Step 1: Broad probes (1-2 words, all projects)
Use high-signal keywords first, for example:
- `oauth`
- `codex`
- `project`
- `voice`
- `trust`
- `sprint`
- `plan`

### Step 2: Inspect hits and IDs
- Pull top hits.
- Note memory IDs, tags, project, and timestamps.

### Step 3: Narrow follow-up queries
- Use specific terms from hits (provider name, file names, exact error fragments).
- Query again with short targeted phrases.

### Step 4: Crawl links
- Use related-memory traversal from the strongest hit IDs.
- Build the cluster before deciding root cause.

### Step 5: Persist + link
- Store final root cause and fix in memory.
- Link to prior relevant memories so future agents can traverse quickly.

## Reusable Incident Template
When closing any auth/debug incident, store:
1. Symptom
2. Root cause
3. File(s) changed
4. Validation method
5. Doc path
6. Linked memory IDs
