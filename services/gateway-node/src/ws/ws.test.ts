import { describe, expect, it, vi } from "vitest";

import { canSubscribe } from "./channels.js";
import { fanout } from "./fanout.js";
import { invoiceReady, outageCountdown, parseInbound } from "./messages.js";
import { addSocket, emptyRegistry } from "./socketRegistry.js";

const operator = "11111111-1111-1111-1111-111111111111";
const subscriber = "22222222-2222-2222-2222-222222222222";

describe("websocket helpers", () => {
  it("enforces channel role matrix", () => {
    expect(canSubscribe({ sub: "u", operatorId: operator, role: "OPERATOR_STAFF" }, "alerts")).toBe(true);
    expect(canSubscribe({ sub: "u", operatorId: operator, role: "OPERATOR_STAFF" }, "invoices")).toBe(false);
    expect(canSubscribe({ sub: "u", operatorId: operator, role: "SUBSCRIBER", subscriberId: subscriber }, "outages")).toBe(true);
  });

  it("parses subscribe messages", () => {
    expect(parseInbound(JSON.stringify({ type: "subscribe", data: { channels: ["alerts"] } }))).toMatchObject({
      type: "subscribe",
    });
    expect(parseInbound("{}")).toBeNull();
  });

  it("computes outage seconds remaining at send time", () => {
    const msg = outageCountdown({
      outageId: "33333333-3333-3333-3333-333333333333",
      startsAt: "2026-06-18T10:01:00.000Z",
      endsAt: "2026-06-18T11:00:00.000Z",
      now: new Date("2026-06-18T10:00:00.000Z"),
    });
    expect(msg.data).toMatchObject({ secondsRemaining: 60 });
  });

  it("filters fanout by operator, subscriber, and subscription", () => {
    const send = vi.fn();
    const otherSend = vi.fn();
    const state = addSocket(
      addSocket(emptyRegistry(), {
        id: "a",
        socket: { send } as any,
        identity: { sub: "u", operatorId: operator, role: "SUBSCRIBER", subscriberId: subscriber },
        channels: new Set(["invoices"]),
      }),
      {
        id: "b",
        socket: { send: otherSend } as any,
        identity: { sub: "u", operatorId: "99999999-9999-9999-9999-999999999999", role: "SUBSCRIBER", subscriberId: subscriber },
        channels: new Set(["invoices"]),
      },
    );

    const sent = fanout(state, {
      operatorId: operator,
      audience: { kind: "subscriber", channel: "invoices", subscriberId: subscriber },
      message: invoiceReady({ invoiceId: "33333333-3333-3333-3333-333333333333", amountUsd: 1, amountLbp: 90000, periodEnd: "2026-06-30" }),
    });

    expect(sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(otherSend).not.toHaveBeenCalled();
  });
});
