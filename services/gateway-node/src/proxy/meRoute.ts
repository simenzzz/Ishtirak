import { type Router } from "express";

import { requireIdentity } from "../auth/authMiddleware.js";

export function registerMeRoute(router: Router): void {
  router.get("/me", (req, res) => {
    const identity = requireIdentity(req);
    res.json({
      operatorId: identity.operatorId,
      role: identity.role,
      ...(identity.subscriberId ? { subscriberId: identity.subscriberId } : {}),
    });
  });
}
