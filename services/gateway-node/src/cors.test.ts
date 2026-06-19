import { describe, expect, it, vi } from "vitest";

import { corsMiddleware } from "./cors.js";

const config = { WEB_ORIGIN: "http://localhost:3000" };

function res() {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 0,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    status: vi.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    end: vi.fn(),
  };
}

describe("corsMiddleware", () => {
  it("echoes the allowed origin and allows credentials", () => {
    const next = vi.fn();
    const r = res();
    corsMiddleware(config)({ method: "GET", headers: { origin: config.WEB_ORIGIN } } as never, r as never, next);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe(config.WEB_ORIGIN);
    expect(r.headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not set CORS headers for a foreign origin", () => {
    const next = vi.fn();
    const r = res();
    corsMiddleware(config)({ method: "GET", headers: { origin: "http://evil.test" } } as never, r as never, next);
    expect(r.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("short-circuits OPTIONS preflight with 204 and method/header lists", () => {
    const next = vi.fn();
    const r = res();
    corsMiddleware(config)({ method: "OPTIONS", headers: { origin: config.WEB_ORIGIN } } as never, r as never, next);
    expect(r.status).toHaveBeenCalledWith(204);
    expect(r.headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect(r.headers["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(r.end).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});
