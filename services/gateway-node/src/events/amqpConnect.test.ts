import { describe, expect, it, vi } from "vitest";

import { connectWithRetry } from "./amqpConnect.js";

const fakeConnection = { tag: "connection" } as never;
const noopSleep = vi.fn().mockResolvedValue(undefined);

describe("connectWithRetry", () => {
  it("returns the connection on first success without sleeping", async () => {
    const connect = vi.fn().mockResolvedValue(fakeConnection);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await connectWithRetry("amqp://broker", { maxAttempts: 5, retryDelayMs: 10 }, { connect, sleep });

    expect(result).toBe(fakeConnection);
    expect(connect).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries transient failures then succeeds", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(fakeConnection);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await connectWithRetry("amqp://broker", { maxAttempts: 5, retryDelayMs: 10 }, { connect, sleep });

    expect(result).toBe(fakeConnection);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("throws the last error after exhausting all attempts", async () => {
    const lastError = new Error("still refused");
    const connect = vi.fn().mockRejectedValueOnce(new Error("first")).mockRejectedValue(lastError);

    await expect(
      connectWithRetry("amqp://broker", { maxAttempts: 3, retryDelayMs: 10 }, { connect, sleep: noopSleep }),
    ).rejects.toBe(lastError);
    expect(connect).toHaveBeenCalledTimes(3);
  });
});
