import express, { type Express, Router, type Request, type Response } from "express";
import { type Redis } from "ioredis";
import { pinoHttp } from "pino-http";

import { authMiddleware } from "./auth/authMiddleware.js";
import { type Config } from "./config.js";
import { corsMiddleware } from "./cors.js";
import { logger } from "./logger.js";
import { registerAnalyticsRoutes } from "./proxy/analyticsRoutes.js";
import { registerAuthRoutes } from "./proxy/authRoutes.js";
import { registerCoreRoutes } from "./proxy/coreRoutes.js";
import { registerMeRoute } from "./proxy/meRoute.js";
import { fixedWindowRateLimit } from "./rateLimit.js";

/**
 * Readiness is reported through a small injectable probe so the HTTP layer
 * stays decoupled from the broker/redis wiring added in Phase 4.
 */
export interface ReadinessProbe {
  isReady(): boolean;
}

const alwaysReady: ReadinessProbe = { isReady: () => true };

export type AppOptions = Readonly<{
  probe?: ReadinessProbe;
  config?: Config;
  redis?: Redis;
}>;

/**
 * Build the Express app. Aggregation and proxy routes are layered on in
 * Phase 4; this factory owns middleware, health, and readiness.
 */
export function createApp(probeOrOptions: ReadinessProbe | AppOptions = alwaysReady): Express {
  const options = "isReady" in probeOrOptions ? { probe: probeOrOptions } : probeOrOptions;
  const probe = options.probe ?? alwaysReady;
  const app = express();

  // Honour exactly one proxy hop so req.ip reflects the real client address.
  // Without this, all requests appear to come from the ingress proxy's IP.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  if (options.config) {
    // Credentialed CORS must run before the routers so cookie-bearing browser
    // requests (and their OPTIONS preflight) are answered correctly.
    app.use(corsMiddleware(options.config));

    const publicApi = Router();
    registerAuthRoutes(publicApi, options.config, options.redis);
    app.use("/api", publicApi);

    const api = Router();
    api.use(authMiddleware(options.config));
    api.use(
      fixedWindowRateLimit({
        redis: options.redis,
        limit: 300,
        windowSecs: 60,
        keyFn: (req) => req.identity?.sub ?? (req.ip ?? "unknown"),
      }),
    );
    registerMeRoute(api);
    registerCoreRoutes(api, options.config);
    registerAnalyticsRoutes(api, options.config);
    app.use("/api", api);
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get("/ready", (_req: Request, res: Response) => {
    const ready = probe.isReady();
    res.status(ready ? 200 : 503).json({ ready });
  });

  return app;
}
