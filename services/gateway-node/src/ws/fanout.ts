import { logger } from "../logger.js";
import { type Channel } from "./channels.js";
import { type RegistryState } from "./socketRegistry.js";
import { type WsMessage } from "./messages.js";

export type Audience = Readonly<
  | { kind: "operator"; channel: "alerts" }
  | { kind: "subscriber"; channel: "invoices" | "outages"; subscriberId?: string }
>;

export type FanoutEnvelope = Readonly<{
  operatorId: string;
  audience: Audience;
  message: WsMessage;
}>;

export function fanout(state: RegistryState, envelope: FanoutEnvelope): number {
  let sent = 0;
  const payload = JSON.stringify(envelope.message);
  for (const binding of state.values()) {
    if (!matches(binding.identity, binding.channels, envelope)) {
      continue;
    }
    try {
      binding.socket.send(payload);
      sent += 1;
    } catch (error) {
      logger.warn({ err: error, id: binding.id }, "ws send failed; socket may be closing");
    }
  }
  return sent;
}

function matches(
  identity: { operatorId: string; role: string; subscriberId?: string },
  subscriptions: ReadonlySet<Channel>,
  envelope: FanoutEnvelope,
): boolean {
  if (identity.operatorId !== envelope.operatorId || !subscriptions.has(envelope.audience.channel)) {
    return false;
  }
  if (envelope.audience.kind === "operator") {
    return identity.role === "OPERATOR_ADMIN" || identity.role === "OPERATOR_STAFF";
  }
  if (identity.role !== "SUBSCRIBER" || !identity.subscriberId) {
    return false;
  }
  return !envelope.audience.subscriberId || envelope.audience.subscriberId === identity.subscriberId;
}
