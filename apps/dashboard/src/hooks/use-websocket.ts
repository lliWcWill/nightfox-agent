"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { WS_URL } from "@/lib/constants";
import { useDashboardStore } from "@/hooks/use-store";
import type { WsMessage } from "@/lib/types";

const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_DELAY = 30000;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

function isWsMessage(value: unknown): value is WsMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { type?: unknown; payload?: unknown };
  return (
    typeof candidate.type === "string" &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null
  );
}

export function useWebSocket(onMessage: (msg: WsMessage) => void) {
  const selectedJobId = useDashboardStore((s) => s.selectedJobId);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const connectRef = useRef<() => void>(() => {});
  const onMessageRef = useRef(onMessage);
  const shouldReconnectRef = useRef(true);
  const attemptRef = useRef(0);
  const lastEventIdRef = useRef(0);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const sendSubscription = useCallback((ws: WebSocket) => {
    ws.send(
      JSON.stringify({
        type: "subscribe",
        sinceId: lastEventIdRef.current,
        jobId: selectedJobId ?? undefined,
        eventTypes: selectedJobId
          ? ["job:start", "job:progress", "job:log", "job:result", "job:end"]
          : undefined,
      })
    );
  }, [selectedJobId]);

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      attemptRef.current = 0;
      sendSubscription(ws);
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      try {
        const parsed = JSON.parse(event.data) as unknown;
        if (isWsMessage(parsed)) {
          if (typeof parsed.id === "number") {
            lastEventIdRef.current = Math.max(lastEventIdRef.current, parsed.id);
          }
          onMessageRef.current(parsed);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;

      if (!shouldReconnectRef.current) {
        return;
      }

      const delay = Math.min(
        RECONNECT_INTERVAL * Math.pow(2, attemptRef.current),
        MAX_RECONNECT_DELAY
      );
      attemptRef.current++;
      reconnectTimer.current = setTimeout(() => {
        setStatus("connecting");
        connectRef.current();
      }, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [sendSubscription]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    const kickoff = setTimeout(() => {
      connect();
    }, 0);

    return () => {
      shouldReconnectRef.current = false;
      clearTimeout(kickoff);
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }
    sendSubscription(wsRef.current);
  }, [selectedJobId, sendSubscription]);

  return { status };
}
