# Nightfox Unified Dashboard Entrypoint Design

## Date

2026-03-11

## Status

Approved design for implementation planning

## Problem

Nightfox currently has two separate dashboard surfaces:

- the bot runtime exposes a lightweight HTTP server with `/api/*` and `/ws`, plus a JSON response at `/`
- the actual dashboard UI lives in `apps/dashboard` as a separate Next.js app

This creates two sources of confusion:

1. The backend default port is `3001`, but the live Discord service overrides it to `3011`
2. Visiting the live backend root returns backend JSON instead of the actual dashboard UI

The long-term product goal is a single public dashboard URL where:

- `/` serves the real UI
- `/api/*` serves Nightfox backend APIs
- `/ws` serves Nightfox realtime event streaming

## Goals

- Make `3011` the canonical Nightfox backend dashboard/API port
- Preserve the bot backend as the source of truth for status, job data, logs, and websocket events
- Preserve the Next.js dashboard as a separate frontend application
- Support a single public URL for operators
- Avoid coupling frontend serving into the bot process itself

## Non-Goals

- Replacing the Nightfox backend HTTP server with Next.js route handlers
- Embedding the dashboard build directly into the bot process
- Designing a full internet-exposed production deployment stack in this patch

## Options Considered

### 1. Align the port and keep the backend JSON root

Change the backend default from `3001` to `3011` and keep `/` as the JSON health response.

Pros:

- smallest change
- removes the current port mismatch

Cons:

- still no actual UI at the primary dashboard URL
- keeps the current operator confusion

### 2. Separate backend and frontend, unify them behind one public URL

Keep Nightfox backend and Next dashboard as separate services, but make the public entrypoint route:

- `/` -> Next dashboard UI
- `/api/*` -> Nightfox backend
- `/ws` -> Nightfox backend websocket
- `/healthz` -> backend health/status

Pros:

- clean separation of concerns
- best long-term deployment shape
- keeps agent introspection APIs first-class
- scales to remote hosting and future dashboard growth

Cons:

- requires proxy or rewrite wiring
- slightly more moving pieces than the current backend-only setup

### 3. Make the bot process serve the dashboard app directly

Teach the Nightfox backend server to serve the Next build itself.

Pros:

- one process and one port

Cons:

- tightly couples UI deploys to bot runtime deploys
- worsens restart behavior and operational blast radius
- makes future hosting and caching more awkward

## Chosen Design

Choose Option 2.

Nightfox should keep two separate runtime responsibilities:

- **backend service**: bot runtime, `/api/*`, `/ws`, health/status, event ledger, logs, job APIs
- **frontend service**: Next dashboard UI

Operators should still get one public dashboard URL, but that composition should happen at the edge/proxy layer rather than inside the bot process.

## Concrete Architecture

### Backend

- Standardize the backend dashboard/API port on `3011`
- Treat this as the canonical Nightfox operator API port
- Keep `/api/*` and `/ws` on the backend service
- Add or standardize an explicit health endpoint such as `/healthz`
- De-emphasize the backend root as an operator landing page

### Frontend

- Run the Next dashboard as its own service
- In local development, keep direct dev ports acceptable
- In deployed/prod mode, the dashboard should assume same-origin API and websocket paths by default:
  - API base: `/api`
  - websocket base: `/ws`

This removes the hardcoded localhost assumptions currently baked into the dashboard app.

### Public Entrypoint

Expose a single public URL using a proxy/rewrite layer:

- `/` -> dashboard frontend
- `/api/*` -> backend on `3011`
- `/ws` -> backend websocket on `3011`
- `/healthz` -> backend health check

This proxy can be implemented with a dedicated reverse proxy later, but the codebase should first be prepared so the frontend and backend already expect this shape.

## Data Flow

1. Browser requests `/`
2. Frontend serves the Next dashboard UI
3. Frontend fetches `/api/fleet/summary`, `/api/tasks`, and job endpoints from the same origin
4. Frontend opens websocket connection to `/ws`
5. Proxy forwards `/api/*` and `/ws` to the Nightfox backend on `3011`
6. Backend remains the authoritative source of runtime state

## Implementation Implications

### Backend changes

- Change default `DASHBOARD_PORT` from `3001` to `3011`
- Add a stable explicit health endpoint if missing
- Keep API/websocket semantics stable
- Update docs and service assumptions to treat `3011` as canonical

### Frontend changes

- Replace production-only hard failure on missing `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL`
- Default production routing to same-origin `/api` and `/ws`
- Keep localhost fallback behavior for local dashboard development if useful
- Document environment overrides clearly

### Ops/dev ergonomics

- Ensure the dashboard workspace can build and run independently
- Document the expected two-service shape
- Document the future public routing layout

## Testing Strategy

### Backend

- config test or command-path verification for default `3011`
- dashboard server tests for explicit health path and unchanged `/api`/`/ws` handling

### Frontend

- unit coverage for URL derivation logic in `apps/dashboard/src/lib/constants.ts`
- build verification for dashboard workspace

### Integration

- manual smoke:
  - backend responds on `3011`
  - dashboard UI renders from frontend service
  - dashboard fetches `/api/*` successfully
  - websocket connects through `/ws`

## Rollout Plan

### Phase 1

- Make `3011` canonical in code and docs
- Remove the most confusing localhost/port assumptions from the dashboard app

### Phase 2

- Stand up the dashboard frontend as a first-class service
- Confirm same-origin `/api` and `/ws` behavior

### Phase 3

- Add the single public URL routing layer
- Move operators to the unified dashboard entrypoint

## Recommendation

Build toward a unified public dashboard URL, but keep the backend and frontend separated internally. This gives Nightfox a clean ops story now and a much better deployment story later.
