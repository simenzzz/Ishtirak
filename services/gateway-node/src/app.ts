import express, { type Express, type Request, type Response } from "express";
import { pinoHttp } from "pino-http";

import { logger } from "./logger.js";

/**
 * Readiness is reported through a small injectable probe so the HTTP layer
 * stays decoupled from the broker/redis wiring added in Phase 4.
 */
export interface ReadinessProbe {
  isReady(): boolean;
}

const alwaysReady: ReadinessProbe = { isReady: () => true };

/**
 * Build the Express app. Aggregation and proxy routes are layered on in
 * Phase 4; this factory owns middleware, health, and readiness.
 */
export function createApp(probe: ReadinessProbe = alwaysReady): Express {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get("/ready", (_req: Request, res: Response) => {
    const ready = probe.isReady();
    res.status(ready ? 200 : 503).json({ ready });
  });

  return app;
}
