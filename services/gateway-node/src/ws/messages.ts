import { z } from "zod";

import { channels, type Channel } from "./channels.js";

const channelSchema = z.enum(channels as [Channel, ...Channel[]]);

export const inboundMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    data: z.object({ channels: z.array(channelSchema).min(1) }),
  }),
  z.object({ type: z.literal("ping") }).passthrough(),
]);

export type InboundMessage = z.infer<typeof inboundMessageSchema>;
export type WsMessage = Readonly<{ type: string; ts?: string; data?: object }>;

export function parseInbound(raw: string): InboundMessage | null {
  try {
    return inboundMessageSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function pong(): WsMessage {
  return Object.freeze({ type: "pong" });
}

export function unauthorized(channel: Channel, reason: string): WsMessage {
  return Object.freeze({ type: "unauthorized", data: { channel, reason } });
}

export function outageCountdown(data: {
  outageId: string;
  startsAt: string;
  endsAt: string;
  now?: Date;
}): WsMessage {
  const now = data.now ?? new Date();
  const secondsRemaining = Math.max(0, Math.floor((Date.parse(data.startsAt) - now.getTime()) / 1000));
  return withTs("outage.countdown", {
    outageId: data.outageId,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    secondsRemaining,
  });
}

export function invoiceReady(data: {
  invoiceId: string;
  amountUsd: number;
  amountLbp: number;
  periodEnd: string;
}): WsMessage {
  return withTs("invoice.ready", data);
}

export function invoiceUpdated(data: {
  invoiceId: string;
  periodEnd: string;
  status: "NEEDS_REVIEW" | "VOID";
}): WsMessage {
  return withTs("invoice.updated", data);
}

export function tamperingAlert(data: {
  subscriberId: string;
  readingId: string;
  reason: string;
  score: number;
}): WsMessage {
  return withTs("tampering.alert", data);
}

function withTs(type: string, data: object): WsMessage {
  return Object.freeze({ type, ts: new Date().toISOString(), data });
}
