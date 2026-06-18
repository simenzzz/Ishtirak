import { type Router } from "express";
import { type Redis } from "ioredis";

import { type Config } from "../config.js";
import { fixedWindowRateLimit } from "../rateLimit.js";
import { forward } from "./forward.js";
import {
  loginBodySchema,
  refreshBodySchema,
  selectContextBodySchema,
} from "./validation.js";

export function registerAuthRoutes(router: Router, config: Config, redis?: Redis): void {
  const limiter = fixedWindowRateLimit({ redis, limit: 10, windowSecs: 60 });
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
    }),
  );
  router.post(
    "/auth/refresh",
    limiter,
    forward({
      config,
      target: "core-java",
      baseUrl: config.CORE_JAVA_URL,
      path: () => "/auth/refresh",
      bodySchema: refreshBodySchema,
      publicRoute: true,
    }),
  );
}
