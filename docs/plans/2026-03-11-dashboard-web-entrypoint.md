# Nightfox Unified Dashboard Entrypoint Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `3011` the canonical Nightfox backend dashboard/API port and prepare the real dashboard UI to live at `/` on a single public origin while `/api` and `/ws` continue to come from the backend.

**Architecture:** Keep the bot backend and Next dashboard as separate services. Standardize the backend on `3011`, make the frontend same-origin aware for `/api` and `/ws`, and introduce an explicit health path so the public root can belong to the UI instead of backend JSON.

**Tech Stack:** TypeScript, Node.js, Next.js, systemd, Nightfox dashboard backend, websocket event stream

---

### Task 1: Lock in backend port expectations

**Files:**
- Modify: `src/config.ts`
- Modify: `src/dashboard/server.ts`
- Test: `src/dashboard/server.test.ts` or the nearest dashboard server test file if none exists yet

**Step 1: Write the failing test**

Add a focused test that proves:

- the default dashboard port is `3011`
- the backend exposes a stable health endpoint such as `/healthz`

Use the smallest direct assertion possible.

**Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/dashboard/server.test.ts
```

Expected:

- failure because the default port or health-path behavior still reflects the old shape

**Step 3: Write minimal implementation**

Implement only:

- `DASHBOARD_PORT` default `3011`
- explicit backend health response route
- keep `/api/*` and `/ws` behavior unchanged

Do not add proxy logic yet.

**Step 4: Run test to verify it passes**

Run:

```bash
node --import tsx --test src/dashboard/server.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add src/config.ts src/dashboard/server.ts src/dashboard/server.test.ts
git commit -m "fix: align dashboard backend defaults to 3011"
```

### Task 2: Make dashboard URL derivation same-origin aware

**Files:**
- Modify: `apps/dashboard/src/lib/constants.ts`
- Test: `apps/dashboard/src/lib/constants.test.ts` (create if missing)

**Step 1: Write the failing test**

Add tests proving:

- local development can still fall back to localhost values
- production mode defaults to same-origin `/api` and `/ws` when explicit env vars are absent
- explicit `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` still override defaults

**Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test apps/dashboard/src/lib/constants.test.ts
```

Expected:

- failure because production still hard-requires env vars and dev defaults still point at `3001`

**Step 3: Write minimal implementation**

Update `constants.ts` so:

- dev fallback targets use `3011`
- production defaults use same-origin `/api` and `/ws`
- env overrides still win

If needed, extract a tiny helper for deterministic URL derivation instead of embedding conditionals inline.

**Step 4: Run test to verify it passes**

Run:

```bash
node --import tsx --test apps/dashboard/src/lib/constants.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add apps/dashboard/src/lib/constants.ts apps/dashboard/src/lib/constants.test.ts
git commit -m "fix: make dashboard frontend use same-origin backend paths"
```

### Task 3: Verify dashboard workspace build stays healthy

**Files:**
- Modify: `apps/dashboard/next.config.ts` only if needed
- Modify: `apps/dashboard/package.json` only if needed
- Reference: `scripts/run-dashboard-workspace.mjs`

**Step 1: Write the failing test**

If a regression test is practical, add the smallest smoke-level coverage for dashboard workspace configuration. If a unit test is not worth it, document this as a command-level verification task instead of inventing fake tests.

**Step 2: Run the failing verification**

Run:

```bash
npm run dashboard:build
```

Expected:

- if changes are incomplete, build or config assumptions fail

**Step 3: Write minimal implementation**

Only adjust workspace config if the build or same-origin assumptions require it. Avoid speculative config churn.

**Step 4: Run verification to green**

Run:

```bash
npm run dashboard:build
```

Expected:

- successful dashboard build

**Step 5: Commit**

```bash
git add apps/dashboard package.json scripts/run-dashboard-workspace.mjs
git commit -m "chore: keep dashboard workspace aligned with backend routing"
```

### Task 4: Document the unified entrypoint contract

**Files:**
- Modify: `README.md`
- Modify: service or ops docs if they already describe dashboard access

**Step 1: Write the failing test**

Add or extend the smallest docs/config assertion that proves:

- `3011` is the canonical backend port
- dashboard UI is the intended public root
- `/api` and `/ws` remain backend surfaces

If no existing doc test exists, treat this as a manual docs verification step.

**Step 2: Run verification to confirm the gap**

Use the existing docs/test harness if available, otherwise inspect the rendered README diff and confirm the old wording is still wrong before editing.

**Step 3: Write minimal implementation**

Document:

- backend on `3011`
- frontend dashboard role
- same-origin `/api` and `/ws`
- explicit health path

Keep docs sharp and operational.

**Step 4: Verify**

Run the relevant README/docs checks if available, otherwise re-read the changed sections directly.

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: describe unified dashboard entrypoint"
```

### Task 5: Manual service smoke after implementation

**Files:**
- Reference: `/home/player3vsgpt/.config/systemd/user/nightfox-discord.service`

**Step 1: Build backend**

Run:

```bash
npm run build
```

Expected:

- backend build succeeds

**Step 2: Build frontend**

Run:

```bash
npm run dashboard:build
```

Expected:

- dashboard build succeeds

**Step 3: Restart backend service**

Run:

```bash
systemctl --user restart nightfox-discord.service
systemctl --user status nightfox-discord.service --no-pager
```

Expected:

- service is active
- dashboard backend announces `3011`

**Step 4: Verify HTTP surfaces**

Run:

```bash
curl -I http://127.0.0.1:3011/healthz
curl -I http://127.0.0.1:3011/api/fleet/summary
```

Expected:

- healthy backend responses

**Step 5: Verify UI contract**

If the frontend service/proxy is part of the patch, verify:

```bash
curl -I http://<dashboard-origin>/
```

Expected:

- `/` serves dashboard UI entrypoint
- `/api/*` and `/ws` remain reachable through the same origin

**Step 6: Commit final ops/docs follow-up if needed**

```bash
git add <changed-files>
git commit -m "test: verify unified dashboard entrypoint smoke checks"
```
