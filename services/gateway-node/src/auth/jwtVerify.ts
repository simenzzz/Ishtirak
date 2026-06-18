import jwt from "jsonwebtoken";
import { z } from "zod";

import { type Config } from "../config.js";
import { freezeIdentity, identityClaimsSchema, type Identity } from "./identity.js";

const accessClaimsSchema = identityClaimsSchema
  .extend({
    typ: z.literal("access"),
    iss: z.literal("core-java"),
    exp: z.number().int().positive(),
  })
  .strip()
  .superRefine((claims, ctx) => {
    if (claims.role === "SUBSCRIBER" && !claims.subscriberId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subscriberId"],
        message: "subscriberId required for subscriber role",
      });
    }
  });

export class AuthError extends Error {
  constructor(message = "Invalid token") {
    super(message);
    this.name = "AuthError";
  }
}

export function verifyAccessToken(token: string, config: Pick<Config, "JWT_SECRET">): Identity {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
    const claims = accessClaimsSchema.parse(decoded);
    return freezeIdentity(claims);
  } catch {
    throw new AuthError();
  }
}
