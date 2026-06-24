import { createHash } from "node:crypto";

import { type Request, type Router } from "express";
import { type Redis } from "ioredis";

import { type Config } from "../config.js";
import { fixedWindowRateLimit } from "../rateLimit.js";
import { forward } from "./forward.js";
import { ingestBatchBodySchema } from "./validation.js";

/**
 * Device-authenticated meter ingest. This route is public to the user-auth
 * middleware: the credential is a device token that core-java authenticates
 * itself, so the gateway only validates the batch shape, rate-limits per device,
 * and passes the `Authorization` header straight through.
 */
export function registerIngestRoutes(router: Router, config: Config, redis?: Redis): void {
  router.post(
    "/ingest/readings",
    fixedWindowRateLimit({ redis, limit: 120, windowSecs: 60, keyFn: deviceKey }),
    forward({
      config,
      target: "core-java",
      baseUrl: config.CORE_JAVA_URL,
      path: () => "/ingest/readings",
      bodySchema: ingestBatchBodySchema,
      forwardClientAuthorization: true,
    }),
  );
}

/** Rate-limit per device (hashed token) so one site can't exhaust another's budget. */
function deviceKey(req: Request): string {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return req.ip ?? "unknown";
  }
  const token = header.slice("Bearer ".length).trim();
  return `dev:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
}
