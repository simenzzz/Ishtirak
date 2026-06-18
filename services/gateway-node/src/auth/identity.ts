import { z } from "zod";

export const roles = ["OPERATOR_ADMIN", "OPERATOR_STAFF", "SUBSCRIBER"] as const;

export type Role = (typeof roles)[number];

export const identityClaimsSchema = z
  .object({
    sub: z.string().min(1),
    operatorId: z.string().uuid(),
    role: z.enum(roles),
    subscriberId: z.string().uuid().optional(),
  })
  .strict();

export const identitySchema = identityClaimsSchema
  .superRefine((claims, ctx) => {
    if (claims.role === "SUBSCRIBER" && !claims.subscriberId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subscriberId"],
        message: "subscriberId required for subscriber role",
      });
    }
  });

export type Identity = Readonly<z.infer<typeof identitySchema>>;

export function freezeIdentity(identity: z.infer<typeof identitySchema>): Identity {
  return Object.freeze({
    sub: identity.sub,
    operatorId: identity.operatorId,
    role: identity.role,
    ...(identity.subscriberId ? { subscriberId: identity.subscriberId } : {}),
  });
}
