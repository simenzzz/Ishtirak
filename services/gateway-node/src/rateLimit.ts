import { type NextFunction, type Request, type Response } from "express";
import { type Redis } from "ioredis";

import { errorBody } from "./auth/authMiddleware.js";
import { logger } from "./logger.js";

export type RateLimitOptions = Readonly<{
  redis?: Redis;
  limit: number;
  windowSecs: number;
  keyFn?: (req: Request) => string;
}>;

export function fixedWindowRateLimit(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!options.redis) {
      next();
      return;
    }
    const clientKey = options.keyFn ? options.keyFn(req) : (req.ip ?? "unknown");
    const key = `rate:${clientKey}:${req.method}:${req.path}:${Math.floor(Date.now() / 1000 / options.windowSecs)}`;
    try {
      const count = await options.redis.incr(key);
      if (count === 1) {
        await options.redis.expire(key, options.windowSecs);
      }
      if (count > options.limit) {
        res.status(429).json(errorBody("RATE_LIMITED", "Rate limit exceeded"));
        return;
      }
    } catch (error) {
      logger.warn({ err: error }, "redis rate limiter unavailable; allowing request");
    }
    next();
  };
}
