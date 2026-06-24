# Contracts

The integration source of truth shared by all services. Changing anything here is
a cross-service API change — update consumers in the same PR.

## Events (`events/`)

Published by `core-java` to the RabbitMQ topic exchange `ishtirak.events`.
JSON Schema (draft 2020-12). Every event shares a common envelope:

| Field | Type | Notes |
|-------|------|-------|
| `eventId` | string (uuid) | unique per emission, for idempotent consumers |
| `eventType` | string | matches the routing key, e.g. `reading.recorded` |
| `operatorId` | string (uuid) | tenant the event belongs to |
| `occurredAt` | string (date-time) | UTC ISO-8601 |
| `payload` | object | event-specific, see each schema |

| Event | Routing key | Emitted when |
|-------|-------------|--------------|
| [`reading-recorded`](events/reading-recorded.schema.json) | `reading.recorded` | a meter reading is ingested |
| [`invoice-issued`](events/invoice-issued.schema.json) | `invoice.issued` | the billing run produces an invoice |
| [`invoice-status-changed`](events/invoice-status-changed.schema.json) | `invoice.status.changed` | an invoice moves to a non-payable state |
| [`payment-received`](events/payment-received.schema.json) | `payment.received` | a payment is recorded |
| [`outage-scheduled`](events/outage-scheduled.schema.json) | `outage.scheduled` | an operator schedules a load-shedding window |

## REST APIs (`openapi/`)

Each service owns an **OpenAPI 3.1** spec describing the routes the gateway
calls; the gateway re-exposes a curated subset to the web client. The operations
are **implemented** — every one carries `x-status: built` (the `x-status: planned`
marker remains reserved for future, not-yet-built routes). Note the specs are
**not** loaded into runtime request validation: each service mirrors them with
hand-written validators (gateway-node uses Zod in `src/proxy/validation.ts`); the
`contracts/*.contract.test.ts` / `test_consumer_contract.py` suites guard against
drift between those validators and the specs. The human-readable companion is
[`docs/API.md`](../docs/API.md).

| Spec | Service | Surface |
|------|---------|---------|
| [`openapi/gateway-node.openapi.yaml`](openapi/gateway-node.openapi.yaml) | gateway-node (8080) | Public BFF (`/api/*`), JWT-authenticated |
| [`openapi/core-java.openapi.yaml`](openapi/core-java.openapi.yaml) | core-java (8081) | Internal system of record |
| [`openapi/analytics-python.openapi.yaml`](openapi/analytics-python.openapi.yaml) | analytics-python (8082) | Internal analytics |
| [`openapi/components.yaml`](openapi/components.yaml) | — | Shared schemas, responses, params, `bearerAuth` (`$ref`'d by the three specs) |

Because OpenAPI 3.1's schema object **is** JSON Schema draft 2020-12 — the same
dialect as the event schemas — the specs `$ref` `events/*.schema.json` directly
(e.g. a create response reuses the emitted event payload) instead of
re-describing it. Domain schemas in `components.yaml` are kept consistent with
the event payloads.

## Async API (`asyncapi.yaml`)

[`asyncapi.yaml`](asyncapi.yaml) (**AsyncAPI 3.1**) describes the asynchronous
surface: the `ishtirak.events` topic exchange with the core domain events (each
message `$ref`s the matching `events/*.schema.json`), and the gateway WebSocket
protocol (server↔client message envelopes). Operations are annotated with the
producing/consuming service.

There is also a fifth channel, **`reading.flagged`** — an internal risk signal
**published by `analytics-python`** (not core-java) and consumed by the gateway
to drive the `tampering.alert` WebSocket push. It has its own
`events/reading-flagged.schema.json` contract, and AsyncAPI references it
directly. (Note: AsyncAPI message payloads use a direct `$ref` to the event
schemas — the `schemaFormat: …draft-2020-12` form is rejected by the AsyncAPI
parser, so don't reintroduce it.)

## Validation

CI (`.github/workflows/ci.yml`, `contracts` job) lints every spec on each PR:

```bash
npx @redocly/cli lint --config contracts/redocly.yaml contracts/openapi/*.openapi.yaml
npx @asyncapi/cli validate contracts/asyncapi.yaml
```
