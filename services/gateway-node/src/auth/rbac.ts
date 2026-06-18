import { type NextFunction, type Request, type Response } from "express";

import { errorBody, requireIdentity } from "./authMiddleware.js";
import { type Role } from "./identity.js";

export function requireRoles(...allowed: Role[]) {
  const roleSet = new Set<Role>(allowed);
  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = requireIdentity(req);
    if (!roleSet.has(identity.role)) {
      res.status(403).json(errorBody("FORBIDDEN", "Role not permitted"));
      return;
    }
    next();
  };
}
