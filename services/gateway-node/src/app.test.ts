import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp, type ReadinessProbe } from "./app.js";

describe("gateway health endpoints", () => {
  it("reports ok on /health", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("returns 200 when ready", async () => {
    const probe: ReadinessProbe = { isReady: () => true };
    const res = await request(createApp(probe)).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
  });

  it("returns 503 when not ready", async () => {
    const probe: ReadinessProbe = { isReady: () => false };
    const res = await request(createApp(probe)).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false });
  });
});
