import { z } from "zod";

export const uuidParamSchema = z.object({ id: z.string().uuid() }).passthrough();
export const pageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .passthrough();

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const selectContextBodySchema = z.object({
  selectionToken: z.string().min(1),
  membershipId: z.string().uuid(),
});

export const refreshBodySchema = z.object({ refreshToken: z.string().min(1) });

export const createSubscriberBodySchema = z.object({
  name: z.string().min(1),
  tierId: z.string().uuid(),
  meterId: z.string().optional(),
});

export const patchSubscriberBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    tierId: z.string().uuid().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "at least one field required");

const tariffPolicySchema = z.enum(["FLAT", "METERED", "HYBRID"]);

export const tierBodySchema = z
  .object({
    name: z.string().min(1),
    amperage: z.number().int().min(1),
    tariffPolicyOverride: tariffPolicySchema.nullable().optional(),
    standingFeeUsd: z.number().min(0),
    standingFeeLbp: z.number().int().min(0),
    perKwhRateUsd: z.number().min(0),
    perKwhRateLbp: z.number().int().min(0),
  })
  .strict();
export const patchTierBodySchema = tierBodySchema
  .partial()
  .extend({
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "at least one field required");

export const recordReadingBodySchema = z.object({
  subscriberId: z.string().uuid(),
  kwh: z.number().min(0),
  readingAt: z.string().datetime(),
});

export const billingRunBodySchema = z.object({
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
});

export const paymentBodySchema = z.object({
  invoiceId: z.string().uuid(),
  currency: z.enum(["USD", "LBP"]),
  tenderedAmount: z.number().positive(),
  method: z.enum(["CASH", "WHISH"]),
});

export const outageBodySchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.enum(["FUEL", "MAINTENANCE", "GRID", "OTHER"]),
});

export const analyticsRiskQuerySchema = pageQuerySchema.extend({
  subscriberId: z.string().uuid().optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
});

export const analyticsCollectionQuerySchema = z
  .object({
    periodStart: z.string().optional(),
    periodEnd: z.string().optional(),
  })
  .strict();
