import { z } from "zod";

import { invoiceReady, outageCountdown, tamperingAlert } from "../ws/messages.js";
import { type FanoutEnvelope } from "../ws/fanout.js";

const baseEnvelope = z.object({
  eventId: z.string().uuid(),
  operatorId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});

export const outageScheduledEventSchema = baseEnvelope.extend({
  eventType: z.literal("outage.scheduled"),
  payload: z.object({
    outageId: z.string().uuid(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    reason: z.enum(["FUEL", "MAINTENANCE", "GRID", "OTHER"]),
  }),
});

export const invoiceIssuedEventSchema = baseEnvelope.extend({
  eventType: z.literal("invoice.issued"),
  payload: z.object({
    invoiceId: z.string().uuid(),
    subscriberId: z.string().uuid(),
    periodStart: z.string(),
    periodEnd: z.string(),
    amountUsd: z.number().min(0),
    amountLbp: z.number().int().min(0),
    kwhConsumed: z.number().min(0),
  }),
});

export const readingFlaggedEventSchema = baseEnvelope.extend({
  eventType: z.literal("reading.flagged"),
  payload: z.object({
    readingId: z.string().uuid(),
    subscriberId: z.string().uuid(),
    reason: z.enum(["NEGATIVE_DELTA", "ZERO_DELTA", "DROP_GT_THRESHOLD", "EXCEEDS_TIER_CAP", "ML_ANOMALY"]),
    score: z.number().min(0).max(1),
  }),
});

export const gatewayEventSchema = z.discriminatedUnion("eventType", [
  outageScheduledEventSchema,
  invoiceIssuedEventSchema,
  readingFlaggedEventSchema,
]);

export type GatewayEvent = z.infer<typeof gatewayEventSchema>;

export function parseGatewayEvent(raw: Buffer): GatewayEvent | null {
  try {
    return gatewayEventSchema.parse(JSON.parse(raw.toString()));
  } catch {
    return null;
  }
}

export function mapEventToFanout(event: GatewayEvent): FanoutEnvelope {
  if (event.eventType === "outage.scheduled") {
    return {
      operatorId: event.operatorId,
      audience: { kind: "subscriber", channel: "outages" },
      message: outageCountdown(event.payload),
    };
  }
  if (event.eventType === "invoice.issued") {
    return {
      operatorId: event.operatorId,
      audience: { kind: "subscriber", channel: "invoices", subscriberId: event.payload.subscriberId },
      message: invoiceReady(event.payload),
    };
  }
  return {
    operatorId: event.operatorId,
    audience: { kind: "operator", channel: "alerts" },
    message: tamperingAlert(event.payload),
  };
}
