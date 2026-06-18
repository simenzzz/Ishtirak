import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { createApp, type ReadinessProbe } from "./app.js";

describe("gateway health endpoints", () => {
  it("reports ok on /health", async () => {
    const res = await dispatch("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("returns 200 when ready", async () => {
    const probe: ReadinessProbe = { isReady: () => true };
    const res = await dispatch("/ready", probe);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
  });

  it("returns 503 when not ready", async () => {
    const probe: ReadinessProbe = { isReady: () => false };
    const res = await dispatch("/ready", probe);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false });
  });
});

async function dispatch(path: string, probe?: ReadinessProbe): Promise<{ status: number; body: unknown }> {
  const app = createApp(probe);
  const req = new PassThrough() as PassThrough & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = "GET";
  req.url = path;
  req.headers = {};

  return await new Promise((resolve, reject) => {
    const res = new PassThrough() as PassThrough & {
      statusCode: number;
      status(value: number): typeof res;
      json(value: unknown): typeof res;
      setHeader(): void;
      getHeader(): undefined;
      end(): typeof res;
    };
    res.statusCode = 200;
    res.status = (value) => {
      res.statusCode = value;
      return res;
    };
    res.json = (value) => {
      resolve({ status: res.statusCode, body: value });
      return res;
    };
    res.setHeader = () => undefined;
    res.getHeader = () => undefined;
    res.end = () => res;
    app.handle(req as never, res as never, reject);
  });
}
