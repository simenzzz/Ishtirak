import { randomUUID } from "node:crypto";
import { type IncomingMessage, type Server } from "node:http";
import { type Duplex } from "node:stream";

import { WebSocketServer, type RawData } from "ws";

import { type Identity } from "../auth/identity.js";
import { verifyAccessToken } from "../auth/jwtVerify.js";
import { type Config } from "../config.js";
import { logger } from "../logger.js";
import { canSubscribe, type Channel } from "./channels.js";
import { parseInbound, pong, unauthorized } from "./messages.js";
import {
  addSocket,
  emptyRegistry,
  removeSocket,
  setSubscriptions,
  type RegistryState,
} from "./socketRegistry.js";

const acceptedProtocol = "ishtirak.v1";

export type GatewayWsServer = Readonly<{
  registry(): RegistryState;
  close(): Promise<void>;
}>;

export function attachWsServer(server: Server, config: Config): GatewayWsServer {
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has(acceptedProtocol) ? acceptedProtocol : false),
  });
  let registry = emptyRegistry();
  const identities = new WeakMap<IncomingMessage, Identity>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/api/ws") {
      socket.destroy();
      return;
    }
    const protocol = extractProtocol(req.headers["sec-websocket-protocol"]);
    const token = protocol?.startsWith("bearer.") ? protocol.slice("bearer.".length) : null;
    if (!token || !hasProtocol(req.headers["sec-websocket-protocol"], acceptedProtocol)) {
      logger.debug({ hasToken: !!token }, "ws upgrade rejected: missing or unrecognized subprotocol");
      socket.destroy();
      return;
    }
    let identity: Identity;
    try {
      identity = verifyAccessToken(token, config);
    } catch (err) {
      logger.debug({ err }, "ws upgrade rejected: access token verification failed");
      socket.destroy();
      return;
    }
    identities.set(req, identity);
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (socket, req) => {
    const identity = identities.get(req);
    if (!identity) {
      socket.close();
      return;
    }
    const id = randomUUID();
    registry = addSocket(registry, Object.freeze({ id, socket, identity, channels: new Set<Channel>() }));
    socket.on("message", (data: RawData) => {
      const parsed = parseInbound(data.toString());
      if (!parsed) {
        return;
      }
      if (parsed.type === "ping") {
        socket.send(JSON.stringify(pong()));
        return;
      }
      const allowed = parsed.data.channels.filter((channel) => canSubscribe(identity, channel));
      const denied = parsed.data.channels.filter((channel) => !canSubscribe(identity, channel));
      registry = setSubscriptions(registry, id, new Set(allowed));
      denied.forEach((channel) => socket.send(JSON.stringify(unauthorized(channel, "channel not permitted"))));
    });
    socket.on("close", () => {
      registry = removeSocket(registry, id);
    });
  });

  return Object.freeze({
    registry: () => registry,
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  });
}

function extractProtocol(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw
    ?.split(",")
    .map((item) => item.trim())
    .find((item) => item.startsWith("bearer."))
    ?? null;
}

function hasProtocol(value: string | string[] | undefined, expected: string): boolean {
  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw
    ?.split(",")
    .map((item) => item.trim())
    .includes(expected)
    ?? false;
}
