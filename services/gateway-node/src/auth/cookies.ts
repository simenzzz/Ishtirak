import { type Request, type Response } from "express";

import { type Config } from "../config.js";

/**
 * Name of the HttpOnly cookie that carries the (rotating) refresh token. The
 * cookie is scoped to the auth path so it is never sent on ordinary API calls,
 * which authenticate with the in-memory access token via the Authorization
 * header instead.
 */
export const REFRESH_COOKIE_NAME = "ishtirak.refresh";
const COOKIE_PATH = "/api/auth";

type CookieConfig = Pick<Config, "COOKIE_SECURE" | "REFRESH_COOKIE_MAX_AGE_SECS">;

/** Set the refresh token as an HttpOnly, SameSite=Strict cookie. */
export function setRefreshCookie(res: Response, token: string, config: CookieConfig): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: config.REFRESH_COOKIE_MAX_AGE_SECS * 1000,
  });
}

/** Clear the refresh cookie. Attributes must match those used when setting it. */
export function clearRefreshCookie(res: Response, config: CookieConfig): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict",
    path: COOKIE_PATH,
  });
}

/** Read the refresh token from the request cookie header, or null if absent. */
export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const name = part.slice(0, index).trim();
    if (name === REFRESH_COOKIE_NAME) {
      const value = part.slice(index + 1).trim();
      if (value.length === 0) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        // Malformed percent-encoding (forged cookie) — fail closed.
        return null;
      }
    }
  }
  return null;
}
