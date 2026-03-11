# Nightfox Dashboard

Nightfox Dashboard is the browser-side operations view for the Nightfox bot stack.
It lives inside the main Nightfox repo at `apps/dashboard`.

It connects to the Nightfox backend over:
- WebSocket: `ws://localhost:3011/ws`
- HTTP API: `http://localhost:3011/api/*`

## Purpose

- Show live fleet state for humans
- Surface queue pressure and background job status
- Provide a machine-queryable view that Nightfox agents can also consume

## Development

```bash
npm install
npm run dashboard:dev
```

Or run it directly from this app directory:

```bash
npm install
npm run dev
```

Override backend endpoints if needed:

```bash
cp .env.example .env.local
NEXT_PUBLIC_WS_URL=ws://localhost:3011/ws
NEXT_PUBLIC_API_URL=http://localhost:3011
```

When those env vars are absent, local development falls back to `3011`, while
production builds default to same-origin backend paths: `/api/*` for HTTP and
`/ws` for the websocket.

## Build

```bash
npm run build
npm start
```
