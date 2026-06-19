import type amqp from "amqplib";
import { describe, expect, it, vi } from "vitest";

import { type RedisFanoutRuntime } from "./redisFanout.js";
import { handleGatewayMessage } from "./rabbitConsumer.js";

const validEvent = JSON.stringify({
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
});

const message = (body: string, redelivered = false) =>
  ({ content: Buffer.from(body), fields: { redelivered } }) as amqp.Message;

const newChannel = () => ({ ack: vi.fn(), nack: vi.fn() });

describe("handleGatewayMessage", () => {
  it("publishes and acks a valid event", async () => {
    const channel = newChannel();
    const fanout = { publish: vi.fn().mockResolvedValue(undefined) } as unknown as RedisFanoutRuntime;
    await handleGatewayMessage(channel, message(validEvent), fanout);
    expect(fanout.publish).toHaveBeenCalledOnce();
    expect(channel.ack).toHaveBeenCalledOnce();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it("dead-letters a poison (unparseable) event without requeue", async () => {
    const channel = newChannel();
    const fanout = { publish: vi.fn() } as unknown as RedisFanoutRuntime;
    await handleGatewayMessage(channel, message("{}"), fanout);
    expect(fanout.publish).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it("requeues once on transient fanout failure (first delivery)", async () => {
    const channel = newChannel();
    const fanout = { publish: vi.fn().mockRejectedValue(new Error("redis down")) } as unknown as RedisFanoutRuntime;
    await handleGatewayMessage(channel, message(validEvent, false), fanout);
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });

  it("dead-letters on transient failure after redelivery", async () => {
    const channel = newChannel();
    const fanout = { publish: vi.fn().mockRejectedValue(new Error("redis down")) } as unknown as RedisFanoutRuntime;
    await handleGatewayMessage(channel, message(validEvent, true), fanout);
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });
});
