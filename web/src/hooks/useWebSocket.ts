import { useCallback, useEffect, useRef, useState } from "react";

import { wsUrlFromApi } from "../lib/config";
import { readAccessToken } from "../lib/tokenStore";
import type { Role, WsChannel, WsEvent } from "../lib/types";

type Handler = (message: WsEvent) => void;
const roleChannels: Record<Role, readonly WsChannel[]> = {
  OPERATOR_ADMIN: ["alerts"],
  OPERATOR_STAFF: ["alerts"],
  SUBSCRIBER: ["outages", "invoices"],
};

function parseMessage(raw: string): WsEvent | null {
  try {
    const value = JSON.parse(raw) as Partial<WsEvent>;
    return typeof value.type === "string" ? (value as WsEvent) : null;
  } catch {
    return null;
  }
}

export function useWebSocket(role: Role | null, onMessage: Handler, onReconnect?: () => void) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onMessage);
  const reconnectRef = useRef(onReconnect);
  handlerRef.current = onMessage;
  reconnectRef.current = onReconnect;

  const subscribe = useCallback((socket: WebSocket, channels: readonly WsChannel[]) => {
    socket.send(JSON.stringify({ type: "subscribe", data: { channels } }));
  }, []);

  useEffect(() => {
    if (!role) return undefined;
    const activeRole = role;
    let closed = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let timeout = 0;

    function connect() {
      const token = readAccessToken();
      if (!token || closed) return;
      socket = new WebSocket(wsUrlFromApi(), ["ishtirak.v1", `bearer.${token}`]);
      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        subscribe(socket!, roleChannels[activeRole]);
        reconnectRef.current?.();
      };
      socket.onmessage = (event) => {
        const parsed = parseMessage(String(event.data));
        if (parsed?.type === "unauthorized") {
          closed = true;
          socket?.close();
        }
        if (parsed) handlerRef.current(parsed);
      };
      socket.onclose = (event) => {
        setConnected(false);
        if (!closed && event.code !== 1008) {
          attempt += 1;
          timeout = window.setTimeout(connect, Math.min(8000, 500 * 2 ** attempt));
        }
      };
    }

    connect();
    return () => {
      closed = true;
      window.clearTimeout(timeout);
      socket?.close();
    };
  }, [role, subscribe]);

  return { connected };
}

export const parseWsMessage = parseMessage;
