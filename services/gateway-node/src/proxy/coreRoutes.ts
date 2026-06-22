import { type Request, type Router } from "express";
import { z } from "zod";

import { requireRoles } from "../auth/rbac.js";
import { type Config } from "../config.js";
import { forward } from "./forward.js";
import {
  billingRunBodySchema,
  createSubscriberBodySchema,
  outageBodySchema,
  pageQuerySchema,
  patchSubscriberBodySchema,
  patchTierBodySchema,
  paymentBodySchema,
  recordReadingBodySchema,
  tierBodySchema,
  uuidParamSchema,
} from "./validation.js";

const staff = requireRoles("OPERATOR_ADMIN", "OPERATOR_STAFF");
const admin = requireRoles("OPERATOR_ADMIN");
const subscriber = requireRoles("SUBSCRIBER");

export function registerCoreRoutes(router: Router, config: Config): void {
  const core = (path: string) => (req: Request) =>
    path.replace(":id", String(req.params["id"] ?? ""));

  router.get("/subscribers", staff, forwardToCore(config, "/subscribers", { querySchema: pageQuerySchema }));
  router.post(
    "/subscribers",
    admin,
    forwardToCore(config, "/subscribers", { bodySchema: createSubscriberBodySchema }),
  );
  router.get(
    "/subscribers/:id",
    staff,
    forwardToCore(config, core("/subscribers/:id"), { paramSchema: uuidParamSchema }),
  );
  router.patch(
    "/subscribers/:id",
    admin,
    forwardToCore(config, core("/subscribers/:id"), {
      paramSchema: uuidParamSchema,
      bodySchema: patchSubscriberBodySchema,
    }),
  );
  router.get("/subscribers/:id/readings", staff, forwardToCore(config, core("/subscribers/:id/readings"), {
    paramSchema: uuidParamSchema,
    querySchema: pageQuerySchema,
  }));

  router.get("/tiers", staff, forwardToCore(config, "/tiers"));
  router.post("/tiers", admin, forwardToCore(config, "/tiers", { bodySchema: tierBodySchema }));
  router.get("/tiers/:id", staff, forwardToCore(config, core("/tiers/:id"), { paramSchema: uuidParamSchema }));
  router.patch(
    "/tiers/:id",
    admin,
    forwardToCore(config, core("/tiers/:id"), { paramSchema: uuidParamSchema, bodySchema: patchTierBodySchema }),
  );

  router.post("/readings", staff, forwardToCore(config, "/readings", { bodySchema: recordReadingBodySchema }));
  router.post(
    "/billing-runs",
    admin,
    forwardToCore(config, "/billing-runs", { bodySchema: billingRunBodySchema }),
  );
  router.get("/invoices", staff, forwardToCore(config, "/invoices", { querySchema: pageQuerySchema }));
  router.get("/invoices/:id", staff, forwardToCore(config, core("/invoices/:id"), { paramSchema: uuidParamSchema }));
  router.post(
    "/invoices/:id/reissue",
    admin,
    forwardToCore(config, core("/invoices/:id/reissue"), { paramSchema: uuidParamSchema }),
  );
  router.post(
    "/invoices/:id/void",
    admin,
    forwardToCore(config, core("/invoices/:id/void"), { paramSchema: uuidParamSchema }),
  );
  router.get(
    "/invoices/:id/payments",
    staff,
    forwardToCore(config, core("/invoices/:id/payments"), { paramSchema: uuidParamSchema }),
  );
  router.post("/payments", staff, forwardToCore(config, "/payments", { bodySchema: paymentBodySchema }));

  router.get("/me/invoices", subscriber, forwardToCore(config, "/me/invoices", { querySchema: pageQuerySchema }));
  router.get("/me/readings", subscriber, forwardToCore(config, "/me/readings", { querySchema: pageQuerySchema }));
  router.get(
    "/me/invoices/:id",
    subscriber,
    forwardToCore(config, core("/me/invoices/:id"), { paramSchema: uuidParamSchema }),
  );
  router.get(
    "/me/invoices/:id/payments",
    subscriber,
    forwardToCore(config, core("/me/invoices/:id/payments"), { paramSchema: uuidParamSchema }),
  );

  router.get("/outages", forwardToCore(config, "/outages"));
  router.post("/outages", admin, forwardToCore(config, "/outages", { bodySchema: outageBodySchema }));
}

function forwardToCore(
  config: Config,
  path: string | ((req: Request) => string),
  options: { bodySchema?: z.ZodTypeAny; querySchema?: z.ZodTypeAny; paramSchema?: z.ZodTypeAny } = {},
) {
  return forward({
    config,
    target: "core-java",
    baseUrl: config.CORE_JAVA_URL,
    path: typeof path === "function" ? path : () => path,
    ...options,
  });
}
