import { describe, expect, it, vi } from "vitest";

import { forward } from "./forward.js";

const identity = {
  sub: "user-1",
  operatorId: "11111111-1111-1111-1111-111111111111",
  role: "OPERATOR_STAFF" as const,
};

const config = {
  PORT: 8080,
  CORE_JAVA_URL: "http://core.local",
  ANALYTICS_URL: "http://analytics.local",
  RABBITMQ_URL: "amqp://localhost",
  REDIS_URL: "redis://localhost",
  JWT_SECRET: "test-jwt-secret-that-is-at-least-32",
  GATEWAY_SERVICE_TOKEN_SECRET: "test-gateway-service-token-secret-32",
  GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET: "test-gateway-analytics-secret-32",
  SERVICE_TOKEN_TTL_SECS: 300,
};

describe("forward", () => {
  it("injects service auth and trusted identity headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = response();

    await forward({
      config,
      target: "core-java",
      baseUrl: config.CORE_JAVA_URL,
      path: () => "/subscribers",
    })(
      {
        method: "POST",
        query: { page: "1" },
        params: {},
        body: { name: "Nour" },
        identity,
        header: (name: string) => (name === "content-type" ? "application/json" : undefined),
      } as any,
      res as any,
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://core.local/subscribers?page=1");
    expect(init.headers.get("x-operator-id")).toBe(identity.operatorId);
    expect(init.headers.get("x-actor-role")).toBe(identity.role);
    expect(init.headers.get("authorization")).toMatch(/^Bearer /);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });

  it("uses requestBody to override the upstream payload and forces json content-type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accessToken: "new" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = response();

    await forward({
      config,
      target: "core-java",
      baseUrl: config.CORE_JAVA_URL,
      path: () => "/auth/refresh",
      publicRoute: true,
      requestBody: () => ({ refreshToken: "from-cookie" }),
    })({ method: "POST", query: {}, params: {}, body: {}, header: () => undefined } as any, res as any);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.get("content-type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ refreshToken: "from-cookie" }));
  });

  it("lets onResponse transform the body and set cookies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accessToken: "at", refreshToken: "rt" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = response();
    const onResponse = vi.fn((_req, _res, _status, body: any) => ({ accessToken: body.accessToken }));

    await forward({
      config,
      target: "core-java",
      baseUrl: config.CORE_JAVA_URL,
      path: () => "/auth/login",
      publicRoute: true,
      onResponse,
    })({ method: "POST", query: {}, params: {}, body: { email: "a" }, header: () => "application/json" } as any, res as any);

    expect(onResponse).toHaveBeenCalledWith(expect.anything(), res, 200, { accessToken: "at", refreshToken: "rt" });
    expect(res.body).toEqual({ accessToken: "at" });
  });

  it("returns validation errors before calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = response();

    await forward({
      config,
      target: "core-java",
      baseUrl: config.CORE_JAVA_URL,
      path: () => "/subscribers",
      bodySchema: { safeParse: () => ({ success: false, error: { issues: [{ message: "bad" }] } }) } as any,
    })({ method: "POST", query: {}, params: {}, body: {}, identity, header: () => undefined } as any, res as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});

function response(): { statusCode: number; body: unknown; status(code: number): any; json(body: unknown): any; end(): void } {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    end() {
      return undefined;
    },
  };
}
