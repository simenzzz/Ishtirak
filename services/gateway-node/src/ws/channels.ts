import { type Identity } from "../auth/identity.js";

export type Channel = "outages" | "invoices" | "alerts";

export const channels: readonly Channel[] = ["outages", "invoices", "alerts"] as const;

export function canSubscribe(identity: Identity, channel: Channel): boolean {
  if (channel === "alerts") {
    return identity.role === "OPERATOR_ADMIN" || identity.role === "OPERATOR_STAFF";
  }
  return identity.role === "SUBSCRIBER" && Boolean(identity.subscriberId);
}
