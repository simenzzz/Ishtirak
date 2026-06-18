import { describe, expect, it, vi } from "vitest";

import { fixedWindowRateLimit } from "./rateLimit.js";

describe("fixedWindowRateLimit", () => {
  it("limits after the configured count", async () => {
    let count = 0;
    const redis = {
      incr: vi.fn(async () => {
        count += 1;
        return count;
      }),
      expire: vi.fn(async () => 1),
    };
    const limiter = fixedWindowRateLimit({ redis: redis as any, limit: 1, windowSecs: 60 });
    const req = { ip: "127.0.0.1", method: "POST", path: "/api/auth/login" };
    const res = response();
    await limiter(req as any, res as any, vi.fn());
    await limiter(req as any, res as any, vi.fn());

    expect(res.statusCode).toBe(429);
  });
});

function response(): { statusCode: number; status(code: number): any; json(body: unknown): any } {
  return {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
}
