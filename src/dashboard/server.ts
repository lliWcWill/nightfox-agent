import { createServer, type Server, type ServerResponse } from 'http';
import { attachWebSocket } from './ws-server.js';
import {
  handleApiRequest,
  agentStatuses,
  recordQueueDequeue,
  recordQueueEnqueue,
  recordQueueProcessing,
} from './api.js';
import { eventBus } from './event-bus.js';
import { APP_SLUG } from '../utils/app-paths.js';
import { DEFAULT_DASHBOARD_PORT } from '../config.js';

let server: Server | null = null;
const DASHBOARD_HEALTH_PATH = '/healthz';

function writeDashboardJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

/**
 * Start and configure the dashboard HTTP server, attach WebSocket support, and initialize agent status tracking.
 *
 * The backend serves an explicit JSON health response at `/healthz`. Other non-API HTTP requests keep the legacy JSON
 * status response so existing callers do not break. The server listens on the provided port (defaults to 3011).
 *
 * @returns The created Node HTTP `Server` instance
 */
export function startDashboardServer(port: number = DEFAULT_DASHBOARD_PORT): Server {
  server = createServer(async (req, res) => {
    const handled = await handleApiRequest(req, res);
    if (!handled) {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === DASHBOARD_HEALTH_PATH) {
        writeDashboardJson(res, 200, {
          status: 'ok',
          service: `${APP_SLUG}-dashboard`,
          endpoint: 'healthz',
        });
        return;
      }

      writeDashboardJson(res, 200, { status: 'ok', service: `${APP_SLUG}-dashboard` });
    }
  });

  attachWebSocket(server);
  wireAgentStatusTracking();

  server.listen(port, () => {
    console.log(`[Dashboard] Server running on http://localhost:${port}`);
    console.log(`[Dashboard] WebSocket at ws://localhost:${port}/ws`);
  });

  return server;
}

/**
 * Stops the running dashboard HTTP server and clears the internal server reference.
 *
 * If a server is active, calls its `close()` method and sets the module-scoped `server` variable to `null`; if no server exists, the function has no effect.
 */
export function stopDashboardServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}

/**
 * Subscribes to runtime events and keeps the in-memory `agentStatuses` map updated.
 *
 * Listens for agent and voice lifecycle events on `eventBus` and updates status, model,
 * currentActivity (truncated to 80 characters when provided), and lastActivity timestamp
 * for the `claude`, `gemini`, and `droid` entries as those events occur.
 */

function wireAgentStatusTracking(): void {
  eventBus.on('agent:start', (ev) => {
    const info = agentStatuses.get('claude')!;
    info.status = 'thinking';
    info.model = ev.model;
    info.currentActivity = ev.prompt.slice(0, 80);
    info.lastActivity = ev.timestamp;
  });

  eventBus.on('agent:complete', (ev) => {
    const info = agentStatuses.get('claude')!;
    info.status = 'ready';
    info.currentActivity = undefined;
    info.lastActivity = ev.timestamp;
  });

  eventBus.on('agent:error', (ev) => {
    const info = agentStatuses.get('claude')!;
    info.status = 'error';
    info.currentActivity = ev.error.slice(0, 80);
    info.lastActivity = ev.timestamp;
  });

  eventBus.on('voice:open', (ev) => {
    const info = agentStatuses.get('gemini')!;
    info.status = 'ready';
    info.lastActivity = ev.timestamp;
  });

  eventBus.on('voice:close', () => {
    const info = agentStatuses.get('gemini')!;
    info.status = 'offline';
  });

  eventBus.on('voice:text', (ev) => {
    const info = agentStatuses.get('gemini')!;
    info.currentActivity = ev.text.slice(0, 80);
    info.lastActivity = ev.timestamp;
  });

  eventBus.on('droid:start', (ev) => {
    const info = agentStatuses.get('droid')!;
    info.status = 'thinking';
    info.model = ev.model;
    info.currentActivity = ev.prompt.slice(0, 80);
    info.lastActivity = ev.timestamp;
  });

  eventBus.on('droid:complete', (ev) => {
    const info = agentStatuses.get('droid')!;
    info.status = ev.isError ? 'error' : 'ready';
    info.currentActivity = undefined;
    info.lastActivity = ev.timestamp;
  });

  eventBus.on('queue:enqueue', (ev) => {
    recordQueueEnqueue(ev);
  });

  eventBus.on('queue:dequeue', (ev) => {
    recordQueueDequeue(ev);
  });

  eventBus.on('queue:processing', (ev) => {
    recordQueueProcessing(ev);
  });
}
