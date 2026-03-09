"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { WS_URL } from "@/lib/constants";
import type { WsMessage } from "@/lib/types";

const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_DELAY = 30000;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useWebSocket(onMessage: (msg: WsMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const connectRef = useRef<() => void>(() => {});
  const onMessageRef = useRef(onMessage);
  const shouldReconnectRef = useRef(true);
  const attemptRef = useRef(0);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

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
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        onMessageRef.current(msg);
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
  }, []);

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

  return { status };
}
