import { type NextFunction, type Request, type Response, type Router } from "express";
import { type Redis } from "ioredis";

import { errorBody } from "../auth/authMiddleware.js";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "../auth/cookies.js";
import { type Config } from "../config.js";
import { logger } from "../logger.js";
import { fixedWindowRateLimit } from "../rateLimit.js";
import { forward } from "./forward.js";
import { loginBodySchema, selectContextBodySchema } from "./validation.js";

/** Best-effort server-side revocation: ask core-java to revoke the token family. */
export async function revokeRefreshToken(config: Config, token: string): Promise<void> {
  const url = new URL("/auth/logout", config.CORE_JAVA_URL);
  // Bounded: a slow/hung core-java must never block clearing the cookie and returning
  // 204, which is the whole point of treating revocation as best-effort.
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ refreshToken: token }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) {
    throw new Error(`core-java logout returned ${response.status}`);
  }
}

/**
 * Logout always clears the browser's refresh cookie so the user is logged out even if
 * core-java is unreachable; revocation of the refresh-token family is best-effort and
 * its failure is logged but never blocks the 204.
 */
export function makeLogoutHandler(
  config: Config,
  revoke: (config: Config, token: string) => Promise<void> = revokeRefreshToken,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const token = readRefreshCookie(req);
    clearRefreshCookie(res, config);
    if (token) {
      try {
        await revoke(config, token);
      } catch (error) {
        logger.error({ err: error }, "refresh-token revocation failed; cookie cleared");
      }
    }
    res.status(204).end();
  };
}

/**
 * Move the refresh token out of the JSON body and into an HttpOnly cookie so it
 * is never exposed to browser JavaScript. Applied to every auth response that
 * may carry a freshly minted (or rotated) refresh token.
 */
export function captureRefreshToken(res: Response, status: number, body: unknown, config: Config): unknown {
  if (status < 200 || status >= 300 || body === null || typeof body !== "object") {
    return body;
  }
  const { refreshToken, ...rest } = body as Record<string, unknown>;
  if (typeof refreshToken === "string" && refreshToken.length > 0) {
    setRefreshCookie(res, refreshToken, config);
  }
  return rest;
}

/** Reject refresh attempts that arrive without the refresh cookie. */
export function requireRefreshCookie(req: Request, res: Response, next: NextFunction): void {
  if (!readRefreshCookie(req)) {
    res.status(401).json(errorBody("UNAUTHORIZED", "Missing refresh credential"));
    return;
  }
  next();
}

export function registerAuthRoutes(router: Router, config: Config, redis?: Redis): void {
  const limiter = fixedWindowRateLimit({ redis, limit: 10, windowSecs: 60 });
  const onResponse = (_req: Request, res: Response, status: number, body: unknown) =>
    captureRefreshToken(res, status, body, config);

  router.post(
    "/auth/login",
    limiter,
    forward({
      config,
      target: "core-java",
      baseUrl: config.CORE_JAVA_URL,
      path: () => "/auth/login",
      bodySchema: loginBodySchema,
      publicRoute: true,
      onResponse,
    }),
  );
  router.post(
    "/auth/select-context",
    limiter,
    forward({
      config,
      target: "core-java",
      baseUrl: config.CORE_JAVA_URL,
      path: () => "/auth/select-context",
      bodySchema: selectContextBodySchema,
      publicRoute: true,
      onResponse,
    }),
  );
  router.post(
    "/auth/refresh",
    limiter,
    requireRefreshCookie,
    forward({
      config,
      target: "core-java",
      baseUrl: config.CORE_JAVA_URL,
      path: () => "/auth/refresh",
      publicRoute: true,
      requestBody: (req) => ({ refreshToken: readRefreshCookie(req) }),
      onResponse,
    }),
  );
  router.post("/auth/logout", limiter, makeLogoutHandler(config));
}
