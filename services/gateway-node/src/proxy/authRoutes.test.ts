import { describe, expect, it, vi } from "vitest";

import { REFRESH_COOKIE_NAME } from "../auth/cookies.js";
import { captureRefreshToken, requireRefreshCookie } from "./authRoutes.js";

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
  WEB_ORIGIN: "http://localhost:3000",
  COOKIE_SECURE: true,
  REFRESH_COOKIE_MAX_AGE_SECS: 2592000,
} as const;

describe("captureRefreshToken", () => {
  it("moves refreshToken from a 2xx body into a cookie and strips it", () => {
    const cookie = vi.fn();
    const out = captureRefreshToken(
      { cookie } as never,
      200,
      { accessToken: "at", refreshToken: "rt", contextSelectionRequired: false },
      config,
    );
    expect(cookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, "rt", expect.objectContaining({ httpOnly: true }));
    expect(out).toEqual({ accessToken: "at", contextSelectionRequired: false });
    expect(out).not.toHaveProperty("refreshToken");
  });

  it("passes selection-required bodies through without a cookie", () => {
    const cookie = vi.fn();
    const body = { contextSelectionRequired: true, selectionToken: "sel", memberships: [] };
    const out = captureRefreshToken({ cookie } as never, 200, body, config);
    expect(cookie).not.toHaveBeenCalled();
    expect(out).toEqual(body);
  });

  it("does not set a cookie on error responses", () => {
    const cookie = vi.fn();
    const body = { error: { code: "UNAUTHORIZED", message: "bad" } };
    const out = captureRefreshToken({ cookie } as never, 401, body, config);
    expect(cookie).not.toHaveBeenCalled();
    expect(out).toEqual(body);
  });
});

describe("requireRefreshCookie", () => {
  it("rejects requests without the refresh cookie", () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    requireRefreshCookie({ headers: {} } as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through when the cookie is present", () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    requireRefreshCookie({ headers: { cookie: `${REFRESH_COOKIE_NAME}=rt` } } as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
