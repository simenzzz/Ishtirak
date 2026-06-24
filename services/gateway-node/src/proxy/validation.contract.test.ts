import $RefParser from "@apidevtools/json-schema-ref-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import * as v from "./validation.js";
import { gatewayOpenApiPath } from "../test/contracts.js";

/**
 * The gateway validates REST requests with hand-written Zod schemas in
 * validation.ts that mirror the request shapes in
 * contracts/openapi/gateway-node.openapi.yaml. Nothing else keeps the two aligned,
 * so these tests bridge them per operationId: a fixture is proven valid against the
 * OpenAPI request schema, then run through the Zod schema. Drift fails the build.
 */

type JsonSchema = Record<string, unknown>;
type Param = { name: string; in: string; required?: boolean; schema: JsonSchema };
type Operation = {
  operationId?: string;
  parameters?: Param[];
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
};
type PathItem = Record<string, unknown>;
type OpenApiDoc = { paths: Record<string, PathItem> };

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
ajv.addFormat("password", () => true); // OpenAPI `format: password` is a hint, not validated.

let doc: OpenApiDoc;

beforeAll(async () => {
  doc = (await $RefParser.dereference(gatewayOpenApiPath())) as OpenApiDoc;
});

function findOperation(operationId: string): { op: Operation; params: Param[] } {
  for (const item of Object.values(doc.paths)) {
    const pathParams = (item.parameters as Param[] | undefined) ?? [];
    for (const method of HTTP_METHODS) {
      const op = item[method] as Operation | undefined;
      if (op?.operationId === operationId) {
        return { op, params: [...pathParams, ...(op.parameters ?? [])] };
      }
    }
  }
  throw new Error(`operation not found in spec: ${operationId}`);
}

function bodySchema(operationId: string): JsonSchema {
  const { op } = findOperation(operationId);
  const schema = op.requestBody?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`no JSON request body for ${operationId}`);
  return schema;
}

/** Assemble an object schema from the `in: query`/`in: path` parameters. */
function paramSchema(operationId: string, location: "query" | "path"): JsonSchema {
  const { params } = findOperation(operationId);
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const p of params.filter((param) => param.in === location)) {
    properties[p.name] = p.schema;
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, required, additionalProperties: true };
}

type Case = { op: string; zod: ZodTypeAny; fixture: Record<string, unknown> };

const UUID = "11111111-1111-1111-1111-111111111111";
const ISO = "2026-06-18T18:00:00Z";
const ISO_LATER = "2026-06-18T22:00:00Z";

const bodyCases: ReadonlyArray<Case> = [
  { op: "login", zod: v.loginBodySchema, fixture: { email: "operator@example.com", password: "s3cret" } },
  { op: "selectAuthContext", zod: v.selectContextBodySchema, fixture: { selectionToken: "sel-token", membershipId: UUID } },
  { op: "apiCreateSubscriber", zod: v.createSubscriberBodySchema, fixture: { name: "Subscriber A", tierId: UUID } },
  { op: "apiUpdateSubscriber", zod: v.patchSubscriberBodySchema, fixture: { name: "Renamed" } },
  {
    op: "apiCreateTier",
    zod: v.tierBodySchema,
    fixture: {
      name: "5A",
      amperage: 5,
      standingFeeUsd: 1.5,
      standingFeeLbp: 130000,
      perKwhRateUsd: 0.1,
      perKwhRateLbp: 9000,
    },
  },
  { op: "apiUpdateTier", zod: v.patchTierBodySchema, fixture: { perKwhRateUsd: 0.2 } },
  { op: "apiRecordReading", zod: v.recordReadingBodySchema, fixture: { subscriberId: UUID, kwh: 12.5, readingAt: ISO } },
  {
    op: "apiIngestReadings",
    zod: v.ingestBatchBodySchema,
    fixture: { readings: [{ meterId: "M-7", kwh: 12.5, readingAt: ISO }] },
  },
  { op: "apiMintDevice", zod: v.deviceMintBodySchema, fixture: { label: "Site A edge" } },
  { op: "apiRunBilling", zod: v.billingRunBodySchema, fixture: { periodStart: "2026-06-01", periodEnd: "2026-06-30" } },
  {
    op: "apiRecordPayment",
    zod: v.paymentBodySchema,
    fixture: { invoiceId: UUID, currency: "USD", tenderedAmount: 50, method: "CASH" },
  },
  { op: "apiScheduleOutage", zod: v.outageBodySchema, fixture: { startsAt: ISO, endsAt: ISO_LATER, reason: "FUEL" } },
];

const queryCases: ReadonlyArray<Case> = [
  { op: "apiListSubscribers", zod: v.pageQuerySchema, fixture: { page: 1, limit: 20 } },
  { op: "apiRiskFlags", zod: v.analyticsRiskQuerySchema, fixture: { subscriberId: UUID, minScore: 0.5, page: 1, limit: 20 } },
  { op: "apiCollectionRate", zod: v.analyticsCollectionQuerySchema, fixture: { periodStart: "2026-06-01", periodEnd: "2026-06-30" } },
];

describe("gateway REST request Zod schemas vs OpenAPI request schemas", () => {
  it.each(bodyCases)("$op: a spec-valid body is accepted by the Zod schema", ({ op, zod, fixture }) => {
    const validate = ajv.compile(bodySchema(op));

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true); // spec side: fixture is honest
    expect(zod.safeParse(fixture).success).toBe(true); // gateway side: must accept it
  });

  it.each(bodyCases)("$op: dropping a spec-required field is rejected by both", ({ op, zod, fixture }) => {
    const schema = bodySchema(op);
    const required = (schema.required as string[] | undefined) ?? [];
    const validate = ajv.compile(schema);

    for (const key of required) {
      const { [key]: _removed, ...rest } = fixture;
      expect(validate(rest), `spec accepted missing ${key}`).toBe(false);
      expect(zod.safeParse(rest).success, `Zod accepted missing ${key}`).toBe(false);
    }
  });

  it.each(queryCases)("$op: spec-valid query params are accepted by the Zod schema", ({ op, zod, fixture }) => {
    const validate = ajv.compile(paramSchema(op, "query"));

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(zod.safeParse(fixture).success).toBe(true);
  });

  it("apiGetSubscriber: the id path param agrees with uuidParamSchema", () => {
    const validate = ajv.compile(paramSchema("apiGetSubscriber", "path"));

    expect(validate({ id: UUID })).toBe(true);
    expect(v.uuidParamSchema.safeParse({ id: UUID }).success).toBe(true);

    expect(validate({ id: "not-a-uuid" })).toBe(false);
    expect(v.uuidParamSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });

  it("every built operation with a request body has a drift test", () => {
    const covered = new Set(bodyCases.map((c) => c.op));
    const missing: string[] = [];
    for (const item of Object.values(doc.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method] as Operation | undefined;
        if (op?.requestBody && op.operationId && !covered.has(op.operationId)) {
          missing.push(op.operationId);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every operation with a required query param has a query drift test", () => {
    // Optional query params are intentionally passed through unvalidated by the gateway,
    // so only *required* ones must have a Zod schema kept in sync here.
    const covered = new Set(queryCases.map((c) => c.op));
    const missing: string[] = [];
    for (const item of Object.values(doc.paths)) {
      const pathParams = (item.parameters as Param[] | undefined) ?? [];
      for (const method of HTTP_METHODS) {
        const op = item[method] as Operation | undefined;
        if (!op?.operationId) continue;
        const hasRequiredQuery = [...pathParams, ...(op.parameters ?? [])].some(
          (p) => p.in === "query" && p.required,
        );
        if (hasRequiredQuery && !covered.has(op.operationId)) missing.push(op.operationId);
      }
    }
    expect(missing).toEqual([]);
  });
});
