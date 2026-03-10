import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { eventBus } from './event-bus.js';
import type { DashboardEventType, WsClientSubscribeMessage, WsMessage } from './types.js';

const ALL_EVENTS: DashboardEventType[] = [
  'agent:start', 'agent:progress', 'agent:tool_start', 'agent:tool_end', 'agent:complete', 'agent:error',
  'voice:open', 'voice:close', 'voice:text', 'voice:tool_call', 'voice:interrupted',
  'droid:start', 'droid:stream', 'droid:complete',
  'session:create', 'session:update', 'session:clear',
  'queue:enqueue', 'queue:dequeue', 'queue:processing',
  'job:queued', 'job:origin', 'job:idempotency', 'job:start', 'job:progress', 'job:log', 'job:result', 'job:end',
];

const HEARTBEAT_INTERVAL_MS = 30_000;
const REPLAY_LIMIT = 500;
const MAX_BUFFERED_AMOUNT_BYTES = 512 * 1024;

type SystemMessageType = 'system:hello' | 'system:heartbeat';
type DashboardWsEnvelope = WsMessage | { type: SystemMessageType; payload: Record<string, unknown>; id?: number; timestamp?: number };

type ClientState = {
  isAlive: boolean;
  subscriptions: {
    eventTypes?: Set<DashboardEventType>;
    jobId?: string;
    sinceId?: number;
  };
};

type ReplayEvent = {
  id: number;
  timestamp: number;
  message: WsMessage;
};

let wss: WebSocketServer | null = null;
let nextEventId = 1;
const replayBuffer: ReplayEvent[] = [];
const clientState = new WeakMap<WebSocket, ClientState>();
let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * Create and attach a WebSocket server at `/ws` that broadcasts dashboard events to connected clients.
 *
 * @param server - The HTTP server to bind the WebSocket server to.
 * @returns The created WebSocketServer instance.
 */
export function attachWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[Dashboard WS] Client connected');
    clientState.set(ws, {
      isAlive: true,
      subscriptions: {},
    });

    ws.on('pong', () => {
      const state = clientState.get(ws);
      if (state) state.isAlive = true;
    });

    ws.on('message', (raw) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString();
        const parsed = JSON.parse(text) as Partial<WsClientSubscribeMessage>;
        if (parsed.type === 'subscribe') {
          const state = clientState.get(ws);
          if (!state) return;
          state.subscriptions = {
            eventTypes: Array.isArray(parsed.eventTypes) ? new Set(parsed.eventTypes) : undefined,
            jobId: typeof parsed.jobId === 'string' ? parsed.jobId : undefined,
            sinceId: typeof parsed.sinceId === 'number' ? parsed.sinceId : undefined,
          };
          replayToClient(ws, state.subscriptions.sinceId);
        }
      } catch {
        // ignore malformed client messages
      }
    });

    ws.on('close', () => {
      console.log('[Dashboard WS] Client disconnected');
      clientState.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('[Dashboard WS] Client error:', err.message);
    });

    sendEnvelope(ws, {
      type: 'system:hello',
      payload: {
        replayBufferSize: replayBuffer.length,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      },
      id: nextEventId++,
      timestamp: Date.now(),
    });
  });

  for (const eventType of ALL_EVENTS) {
    eventBus.on(eventType, (payload) => {
      const message = {
        type: eventType,
        payload,
        id: nextEventId++,
        timestamp: Date.now(),
      } as WsMessage;
      appendReplay(message);
      broadcast(message);
    });
  }

  startHeartbeat();

  console.log('[Dashboard WS] WebSocket server attached');
  return wss;
}

function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      const state = clientState.get(ws);
      if (!state) continue;
      if (!state.isAlive) {
        ws.terminate();
        clientState.delete(ws);
        continue;
      }
      state.isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        sendEnvelope(ws, {
          type: 'system:heartbeat',
          payload: { at: Date.now() },
          id: nextEventId++,
          timestamp: Date.now(),
        });
        ws.ping();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function appendReplay(message: WsMessage): void {
  replayBuffer.push({
    id: typeof message.id === 'number' ? message.id : nextEventId++,
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    message,
  });
  if (replayBuffer.length > REPLAY_LIMIT) {
    replayBuffer.splice(0, replayBuffer.length - REPLAY_LIMIT);
  }
}

function replayToClient(ws: WebSocket, sinceId?: number): void {
  if (typeof sinceId !== 'number') return;
  for (const item of replayBuffer) {
    if (item.id > sinceId && shouldSendToClient(ws, item.message)) {
      sendEnvelope(ws, item.message);
    }
  }
}

function matchesJobId(message: WsMessage, expectedJobId?: string): boolean {
  if (!expectedJobId) return true;
  const payload = message.payload as Record<string, unknown>;
  return payload.jobId === expectedJobId;
}

function shouldSendToClient(ws: WebSocket, message: WsMessage): boolean {
  const state = clientState.get(ws);
  if (!state) return false;
  const { eventTypes, jobId } = state.subscriptions;
  if (eventTypes && !eventTypes.has(message.type as DashboardEventType)) return false;
  if (!matchesJobId(message, jobId)) return false;
  return true;
}

function sendEnvelope(ws: WebSocket, message: DashboardWsEnvelope): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > MAX_BUFFERED_AMOUNT_BYTES) {
    ws.terminate();
    clientState.delete(ws);
    return;
  }
  ws.send(JSON.stringify(message));
}

/**
 * Broadcasts a dashboard message to all connected WebSocket clients.
 *
 * @param message - The message to serialize and send to every client currently connected with an open socket
 */
function broadcast(message: WsMessage): void {
  if (!wss) return;
  for (const client of wss.clients) {
    if (shouldSendToClient(client, message)) {
      sendEnvelope(client, message);
    }
  }
}
