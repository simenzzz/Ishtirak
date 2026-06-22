import { PassThrough } from "node:stream";

import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";

import { createApp, type ReadinessProbe } from "./app.js";
import { type Config } from "./config.js";

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

const config: Config = {
  PORT: 8080,
  CORE_JAVA_URL: "http://core.local",
  ANALYTICS_URL: "http://analytics.local",
  RABBITMQ_URL: "amqp://localhost",
  REDIS_URL: "redis://localhost",
  JWT_SECRET: "test-jwt-secret-that-is-at-least-32",
  GATEWAY_SERVICE_TOKEN_SECRET: "test-gateway-service-token-secret-32",
  GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET: "test-gateway-analytics-secret-32",
  SERVICE_TOKEN_TTL_SECS: 300,
  WEB_ORIGIN: "http://localhost:3000",
  COOKIE_SECURE: false,
  REFRESH_COOKIE_MAX_AGE_SECS: 2592000,
  AUTH_RATE_LIMIT: 100,
};

describe("core invoice resolution proxy routes", () => {
  it.each(["reissue", "void"])("forwards admin %s requests to core", async (action) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "invoice-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const invoiceId = "22222222-2222-4222-8222-222222222222";

    const res = await dispatchApi("POST", `/api/invoices/${invoiceId}/${action}`, token("OPERATOR_ADMIN"));

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`http://core.local/invoices/${invoiceId}/${action}`);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("rejects invoice resolution routes for staff users", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await dispatchApi(
      "POST",
      "/api/invoices/22222222-2222-4222-8222-222222222222/reissue",
      token("OPERATOR_STAFF"),
    );

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates invoice resolution route params before proxying", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await dispatchApi("POST", "/api/invoices/not-a-uuid/void", token("OPERATOR_ADMIN"));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function token(role: "OPERATOR_ADMIN" | "OPERATOR_STAFF") {
  return jwt.sign({
    sub: "user-1",
    operatorId: "11111111-1111-1111-1111-111111111111",
    role,
    typ: "access",
    iss: "core-java",
  }, config.JWT_SECRET, { expiresIn: 300 });
}

async function dispatchApi(method: string, path: string, bearerToken: string): Promise<{ status: number; body: unknown }> {
  const app = createApp({ config });
  const req = new PassThrough() as PassThrough & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = method;
  req.url = path;
  req.headers = { authorization: `Bearer ${bearerToken}` };
  queueMicrotask(() => req.push(null));

  return await new Promise((resolve, reject) => {
    const res = response(resolve);
    app.handle(req as never, res as never, reject);
  });
}

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
    const res = response(resolve);
    app.handle(req as never, res as never, reject);
  });
}

function response(resolve: (value: { status: number; body: unknown }) => void) {
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
  res.end = () => {
    resolve({ status: res.statusCode, body: undefined });
    return res;
  };
  return res;
}
