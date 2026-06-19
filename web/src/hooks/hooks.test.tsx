import { act, renderHook, waitFor } from "@testing-library/react";

import { deriveSecondsRemaining, useCountdown } from "./useCountdown";
import { parseWsMessage, useWebSocket } from "./useWebSocket";
import { clearAccessToken, writeAccessToken } from "../lib/tokenStore";
import { installMockWebSocket, MockWebSocket } from "../test/testUtils";

describe("countdown hook", () => {
  it("derives local seconds from the outage end time", () => {
    const now = new Date("2026-06-18T10:00:00Z").getTime();
    expect(deriveSecondsRemaining({ startsAt: "2026-06-18T09:00:00Z", endsAt: "2026-06-18T10:00:05Z" }, now)).toBe(5);
    expect(deriveSecondsRemaining({ startsAt: "2026-06-18T10:01:00Z", endsAt: "2026-06-18T11:00:00Z" }, now)).toBe(60);
  });

  it("ticks down from a seed", () => {
    vi.useFakeTimers();
    const seed = { startsAt: new Date(Date.now()).toISOString(), endsAt: new Date(Date.now() + 3000).toISOString() };
    const { result } = renderHook(() => useCountdown(seed));
    expect(result.current).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(3500));
    expect(result.current).toBe(0);
    vi.useRealTimers();
  });
});

describe("websocket hook", () => {
  beforeEach(() => {
    clearAccessToken();
    installMockWebSocket();
    writeAccessToken("token");
  });

  it("subscribes to role channels and parses messages", async () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket("SUBSCRIBER", onMessage));
    await waitFor(() => expect(MockWebSocket.instances[0]?.sent[0]).toContain("outages"));
    const socket = MockWebSocket.instances[0]!;
    expect(socket.protocols).toEqual(["ishtirak.v1", "bearer.token"]);
    expect(socket.sent[0]).toContain("outages");
    act(() => socket.emit({ type: "invoice.ready", data: { invoiceId: "i", amountUsd: 1, amountLbp: 90000, periodEnd: "2026-06-30" } }));
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "invoice.ready" }));
  });

  it("ignores invalid websocket frames", () => {
    expect(parseWsMessage("{")).toBeNull();
  });
});
