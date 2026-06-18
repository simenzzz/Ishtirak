import { type Router } from "express";

import { requireRoles } from "../auth/rbac.js";
import { type Config } from "../config.js";
import { forward } from "./forward.js";
import { analyticsCollectionQuerySchema, analyticsRiskQuerySchema } from "./validation.js";

export function registerAnalyticsRoutes(router: Router, config: Config): void {
  const staff = requireRoles("OPERATOR_ADMIN", "OPERATOR_STAFF");
  router.get(
    "/analytics/collection-rate",
    staff,
    forward({
      config,
      target: "analytics-python",
      baseUrl: config.ANALYTICS_URL,
      path: () => "/analytics/collection-rate",
      querySchema: analyticsCollectionQuerySchema,
    }),
  );
  router.get(
    "/analytics/risk",
    staff,
    forward({
      config,
      target: "analytics-python",
      baseUrl: config.ANALYTICS_URL,
      path: () => "/analytics/risk",
      querySchema: analyticsRiskQuerySchema,
    }),
  );
}
