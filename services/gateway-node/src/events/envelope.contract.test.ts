import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { loadEventSchema } from "../test/contracts.js";
import { gatewayEventSchema, parseGatewayEvent } from "./envelope.js";

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));

// Compile each schema once: Ajv rejects re-registering a schema with the same $id.
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function validatorFor(schemaFile: string): ReturnType<typeof ajv.compile> {
  let validate = validators.get(schemaFile);
  if (!validate) {
    validate = ajv.compile(loadEventSchema(schemaFile));
    validators.set(schemaFile, validate);
  }
  return validate;
}

type Fixture = Record<string, unknown> & { payload: Record<string, unknown> };

const baseEnvelope = {
  eventId: "11111111-1111-1111-1111-111111111111",
  operatorId: "22222222-2222-2222-2222-222222222222",
  occurredAt: "2026-06-18T10:00:00Z",
};

// (schema file, valid fixture) for every event the gateway actually consumes.
const cases: ReadonlyArray<readonly [string, Fixture]> = [
  [
    "outage-scheduled.schema.json",
    {
      ...baseEnvelope,
      eventType: "outage.scheduled",
      payload: {
        outageId: "33333333-3333-3333-3333-333333333333",
        startsAt: "2026-06-18T18:00:00Z",
        endsAt: "2026-06-18T22:00:00Z",
        reason: "FUEL",
      },
    },
  ],
  [
    "invoice-issued.schema.json",
    {
      ...baseEnvelope,
      eventType: "invoice.issued",
      payload: {
        invoiceId: "44444444-4444-4444-4444-444444444444",
        subscriberId: "55555555-5555-5555-5555-555555555555",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        amountUsd: 100,
        amountLbp: 9000000,
        kwhConsumed: 20,
      },
    },
  ],
  [
    "invoice-status-changed.schema.json",
    {
      ...baseEnvelope,
      eventType: "invoice.status.changed",
      payload: {
        invoiceId: "44444444-4444-4444-4444-444444444444",
        subscriberId: "55555555-5555-5555-5555-555555555555",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        status: "NEEDS_REVIEW",
      },
    },
  ],
  [
    "reading-flagged.schema.json",
    {
      ...baseEnvelope,
      eventType: "reading.flagged",
      payload: {
        readingId: "66666666-6666-6666-6666-666666666666",
        subscriberId: "55555555-5555-5555-5555-555555555555",
        reason: "NEGATIVE_DELTA",
        score: 0.9,
      },
    },
  ],
];

describe("gateway event Zod schemas vs contracts/events JSON Schemas", () => {
  it.each(cases)("%s: a contract-valid event is accepted by the Zod schema", (schemaFile, fixture) => {
    const validate = validatorFor(schemaFile);

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true); // schema side: fixture is honest
    expect(() => gatewayEventSchema.parse(fixture)).not.toThrow(); // consumer side: must accept it
  });

  it.each(cases)("%s: dropping a contract-required field is rejected by both", (schemaFile, fixture) => {
    const schema = loadEventSchema(schemaFile) as unknown as {
      required: string[];
      properties: { payload: { required: string[] } };
    };
    const validate = validatorFor(schemaFile);

    for (const key of schema.required) {
      const { [key]: _removed, ...rest } = fixture;
      expect(validate(rest), `schema accepted missing ${key}`).toBe(false);
      expect(parseGatewayEvent(Buffer.from(JSON.stringify(rest))), `Zod accepted missing ${key}`).toBeNull();
    }
    for (const key of schema.properties.payload.required) {
      const { [key]: _removed, ...payloadRest } = fixture.payload;
      const mutated = { ...fixture, payload: payloadRest };
      expect(validate(mutated), `schema accepted missing payload.${key}`).toBe(false);
      expect(
        parseGatewayEvent(Buffer.from(JSON.stringify(mutated))),
        `Zod accepted missing payload.${key}`,
      ).toBeNull();
    }
  });
});
