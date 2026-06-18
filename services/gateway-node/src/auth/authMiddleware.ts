import { type NextFunction, type Request, type Response } from "express";

import { type Config } from "../config.js";
import { verifyAccessToken } from "./jwtVerify.js";
import { type Identity } from "./identity.js";

declare module "express-serve-static-core" {
  interface Request {
    identity?: Identity;
  }
}

export function authMiddleware(config: Pick<Config, "JWT_SECRET">) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization");
    const token = parseBearer(header);
    if (!token) {
      res.status(401).json(errorBody("UNAUTHORIZED", "Missing bearer token"));
      return;
    }
    try {
      req.identity = verifyAccessToken(token, config);
      next();
    } catch {
      res.status(401).json(errorBody("UNAUTHORIZED", "Invalid bearer token"));
    }
  };
}

export function requireIdentity(req: Request): Identity {
  if (!req.identity) {
    throw new Error("identity missing; authMiddleware must run first");
  }
  return req.identity;
}

function parseBearer(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function errorBody(code: string, message: string): object {
  return { error: { code, message, details: [] } };
}
