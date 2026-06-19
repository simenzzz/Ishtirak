import { type NextFunction, type Request, type Response } from "express";

import { type Config } from "./config.js";

const ALLOWED_METHODS = "GET,POST,PATCH,OPTIONS";
const ALLOWED_HEADERS = "authorization, content-type, idempotency-key";
const MAX_AGE_SECS = "600";

/**
 * Credentialed CORS for the browser client. The web app runs on a different
 * origin than the gateway, so cookie-bearing requests require the exact origin
 * to be echoed (wildcards are forbidden with credentials) plus
 * `Access-Control-Allow-Credentials`. Preflight `OPTIONS` is short-circuited.
 */
export function corsMiddleware(config: Pick<Config, "WEB_ORIGIN">) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Always vary on Origin so a shared cache never serves an origin-specific
    // response (or its absence of CORS headers) to a different origin.
    res.setHeader("Vary", "Origin");
    const origin = req.headers.origin;
    if (origin === config.WEB_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", config.WEB_ORIGIN);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
      res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
      res.setHeader("Access-Control-Max-Age", MAX_AGE_SECS);
      res.status(204).end();
      return;
    }
    next();
  };
}
