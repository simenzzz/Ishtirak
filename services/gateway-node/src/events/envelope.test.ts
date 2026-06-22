import { describe, expect, it } from "vitest";

import { mapEventToFanout, parseGatewayEvent } from "./envelope.js";

describe("gateway event envelope", () => {
  it("maps invoice events to subscriber invoice messages", () => {
    const event = parseGatewayEvent(
      Buffer.from(
        JSON.stringify({
          eventId: "11111111-1111-1111-1111-111111111111",
          eventType: "invoice.issued",
          operatorId: "22222222-2222-2222-2222-222222222222",
          occurredAt: "2026-06-18T10:00:00Z",
          payload: {
            invoiceId: "33333333-3333-3333-3333-333333333333",
            subscriberId: "44444444-4444-4444-4444-444444444444",
            periodStart: "2026-06-01",
            periodEnd: "2026-06-30",
            amountUsd: 100,
            amountLbp: 9000000,
            kwhConsumed: 20,
          },
        }),
      ),
    );

    expect(event).not.toBeNull();
    expect(mapEventToFanout(event!)).toMatchObject({
      audience: { kind: "subscriber", channel: "invoices", subscriberId: "44444444-4444-4444-4444-444444444444" },
      message: { type: "invoice.ready" },
    });
  });

  it("maps invoice status changes to subscriber invoice invalidations", () => {
    const event = parseGatewayEvent(
      Buffer.from(
        JSON.stringify({
          eventId: "11111111-1111-1111-1111-111111111111",
          eventType: "invoice.status.changed",
          operatorId: "22222222-2222-2222-2222-222222222222",
          occurredAt: "2026-06-18T10:00:00Z",
          payload: {
            invoiceId: "33333333-3333-3333-3333-333333333333",
            subscriberId: "44444444-4444-4444-4444-444444444444",
            periodStart: "2026-06-01",
            periodEnd: "2026-06-30",
            status: "NEEDS_REVIEW",
          },
        }),
      ),
    );

    expect(event).not.toBeNull();
    expect(mapEventToFanout(event!)).toMatchObject({
      audience: { kind: "subscriber", channel: "invoices", subscriberId: "44444444-4444-4444-4444-444444444444" },
      message: { type: "invoice.updated", data: { status: "NEEDS_REVIEW" } },
    });
  });

  it("rejects malformed events", () => {
    expect(parseGatewayEvent(Buffer.from("{}"))).toBeNull();
  });
});
