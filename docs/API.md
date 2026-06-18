# API Reference

> **Scope.** The **target** API surface of Ishtirak across all services — the
> public gateway BFF, the internal `core-java` and `analytics-python` REST APIs,
> the WebSocket protocol, and the asynchronous event API. It is **design-forward**:
> it documents what we are building toward, with each endpoint tagged for its
> current state. For structure see [`ARCHITECTURE.md`](./ARCHITECTURE.md); for
> behaviour see [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md); for sequencing see
> [`ROADMAP.md`](./ROADMAP.md).
>
> **Status legend:** ✅ built · ⏳ planned. Today only `/health` and `/ready` on
> each service are ✅; the four async events are ✅ **defined** in
> [`contracts/events`](../contracts/events). Everything else is ⏳.
>
> **Source of truth.** This document is the human-readable companion to the
> machine-readable contracts: per-service **OpenAPI 3.1** specs under
> [`contracts/openapi/`](../contracts/openapi) (the curated public BFF plus the
> internal `core-java` / `analytics-python` REST), the **AsyncAPI** spec
> [`contracts/asyncapi.yaml`](../contracts/asyncapi.yaml) (events + WebSocket),
> and the event JSON Schemas in [`contracts/events`](../contracts/events). The
> specs use the same ✅/⏳ marking via `x-status: built | planned`. When this
> doc and the specs disagree, the specs win — keep them in lockstep.

## Conventions

- **Base URLs** (local / docker-compose):
  | Service | Base URL | Audience |
  | ------- | -------- | -------- |
  | gateway-node (BFF) | `http://localhost:8080` | browser (public) |
  | core-java | `http://localhost:8081` | internal only |
  | analytics-python | `http://localhost:8082` | internal only |

  The browser talks **only** to the gateway (ADR-003). `core-java` and
  `analytics-python` are internal; their REST is consumed by the gateway.
- **Format.** JSON request/response; `Content-Type: application/json`. Timestamps
  are ISO-8601 UTC. Billing is dual-currency: invoices carry `amountUsd` and
  `amountLbp`; payments carry tendered currency plus `appliedUsd` / `appliedLbp`.
- **Authentication.** Bearer JWT on the gateway: `Authorization: Bearer <token>`.
  The gateway verifies the token (secret ≥32 chars, validated at boot) and
  derives `operatorId` + role from it — **never** from request parameters
  (ADR-003). Internal services (`core-java`, `analytics-python`) are not
  browser-reachable; they accept a gateway-signed **service** token (not the
  browser JWT) and receive the end-user identity as gateway-injected trusted
  headers `X-Operator-Id` + `X-Actor-Role` plus `X-Actor-Subscriber-Id` for
  subscriber callers. The service token carries matching `operatorId`, `role`,
  and optional `subscriberId` claims; internal services reject mismatches and
  scope every query by those values. ⏳ Gateway middleware lands in Phase 4.
- **Tenant scoping.** Every resource is implicitly scoped to the caller's
  `operatorId`. Clients never pass `operatorId`; the server injects it.
- **Roles.** `OPERATOR_ADMIN`, `OPERATOR_STAFF` (dashboard) and `SUBSCRIBER`
  (portal). Endpoints below note the role they require.
- **Errors.** Consistent envelope:
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "human-readable",
               "details": [ { "field": "kwh", "issue": "must be >= 0" } ] } }
  ```
  Status codes: `400` validation, `401` missing/invalid token, `403` wrong role
  / cross-tenant, `404` not found, `409` conflict (e.g. duplicate invoice),
  `429` rate-limited (gateway Redis limits plus defensive core-java mutation
  limits), `500` server. Error messages never leak secrets
  or internal detail; `details[].issue` is user-safe text only.
- **Pagination.** List endpoints accept `?page` (1-based) and `?limit`
  (default 20, max 100) and return:
  ```json
  { "data": [ ... ], "meta": { "total": 0, "page": 1, "limit": 20 } }
  ```
- **Idempotency.** Mutating endpoints that trigger events accept an optional
  `Idempotency-Key` header so retries don't double-issue (e.g. a billing run).

---

## Gateway BFF — public API

Prefix: `/api`. This is the curated surface the [web client](../web) consumes.
The gateway authenticates, then aggregates/proxies to the internal services.

### Auth
| Method | Path | Role | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/auth/login` | public | Exchange email/password credentials; returns tokens for a single membership or a selection token plus available memberships for multi-home users. ⏳ |
| `POST` | `/api/auth/select-context` | public | Exchange a selection token + membership id for context-bound access/refresh tokens. ⏳ |
| `POST` | `/api/auth/refresh` | any | Rotate a single-use refresh token; reuse revokes the token family. ⏳ |
| `GET`  | `/api/me` | any | Current identity (operator, role). ⏳ |

### Subscribers & tiers
| Method | Path | Role | Description |
| ------ | ---- | ---- | ----------- |
| `GET`  | `/api/subscribers` | staff/admin | List subscribers (paginated). ⏳ |
| `POST` | `/api/subscribers` | admin | Create a subscriber (name, tierId, meterId). ⏳ |
| `GET`  | `/api/subscribers/{id}` | staff/admin | Subscriber detail. ⏳ |
| `PATCH`| `/api/subscribers/{id}` | admin | Update tier / details. ⏳ |
| `GET`  | `/api/tiers` | staff/admin | List amperage tiers + pricing. ⏳ |
| `POST` | `/api/tiers` | admin | Create an amperage tier with pricing and optional tariff override. ⏳ |
| `GET`  | `/api/tiers/{id}` | staff/admin | Tier detail. ⏳ |
| `PATCH`| `/api/tiers/{id}` | admin | Update tier pricing, tariff override, or status. ⏳ |

### Readings
| Method | Path | Role | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/readings` | staff/admin | Record a meter reading (`subscriberId`, `kwh`, `readingAt`). Triggers `reading.recorded`. ⏳ |
| `GET`  | `/api/subscribers/{id}/readings` | staff/admin | Reading history. ⏳ |
| `GET`  | `/api/me/readings` | subscriber | The caller's own reading history. ⏳ |

### Billing & invoices
| Method | Path | Role | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/billing-runs` | admin | Trigger the monthly billing run for a period. Issues invoices, triggers `invoice.issued`. Accepts `Idempotency-Key`. ⏳ |
| `GET`  | `/api/invoices` | staff/admin | List invoices (filter by period, status). ⏳ |
| `GET`  | `/api/invoices/{id}` | staff/admin | Invoice detail. ⏳ |
| `GET`  | `/api/me/invoices` | subscriber | The caller's own invoices (portal). ⏳ |
| `GET`  | `/api/me/invoices/{id}` | subscriber | One invoice owned by the caller. ⏳ |

### Payments
| Method | Path | Role | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/payments` | staff/admin | Record a payment (`invoiceId`, `currency`, `tenderedAmount`, `method`). Triggers `payment.received`. ⏳ |
| `GET`  | `/api/invoices/{id}/payments` | staff/admin | Payments for an invoice. ⏳ |
| `GET`  | `/api/me/invoices/{id}/payments` | subscriber | Payments for one invoice owned by the caller. ⏳ |

### Outages
| Method | Path | Role | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/outages` | admin | Schedule a load-shedding window (`startsAt`, `endsAt`, `reason`). Triggers `outage.scheduled`. ⏳ |
| `GET`  | `/api/outages` | any | Scheduled/active outages (operator or subscriber view). ⏳ |

### Analytics (proxied to analytics-python)
| Method | Path | Role | Description |
| ------ | ---- | ---- | ----------- |
| `GET`  | `/api/analytics/collection-rate` | staff/admin | Collection-rate summary. ⏳ |
| `GET`  | `/api/analytics/risk` | staff/admin | Tampering risk flags (filter by `subscriberId`, `minScore`). ⏳ |

### Real-time
| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/api/ws` (Upgrade) | WebSocket upgrade; JWT-authenticated. See [WebSocket protocol](#websocket-protocol). ⏳ |

### Health ✅
| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/health` | `{ "status": "ok" }`. ✅ |
| `GET`  | `/ready`  | `{ "ready": true \| false }` — `503` when not ready. ✅ |

---

## core-java REST — internal system of record

Base: `http://localhost:8081`. Consumed by the gateway. Request/response shapes
align with the [domain model](./SYSTEM_DESIGN.md#domain-model) and the
[event payloads](#asynchronous-events). Mutations run in a DB transaction that
also writes the corresponding event to a transactional outbox; the outbox is
published to `ishtirak.events` after commit. Paths have **no `/api` prefix** —
this is the internal surface the gateway proxies to.

core-java is the **token issuer**: it owns the auth endpoints below, which the
gateway's `/api/auth/*` will front in Phase 4.

| Method | Path | Emits | Description |
| ------ | ---- | ----- | ----------- |
| `POST` | `/auth/login` | — | Exchange email/password; returns tokens or a selection token + memberships. ✅ |
| `POST` | `/auth/select-context` | — | Exchange a selection token + membership id for access/refresh tokens. ✅ |
| `POST` | `/auth/refresh` | — | Rotate a single-use refresh token; reuse revokes the family. ✅ |
| `GET`/`POST` | `/subscribers`, `/subscribers/{id}` | — | List/create subscribers; subscriber detail (`GET`/`POST` only — no `PATCH`). ✅ |
| `GET`/`POST` | `/tiers`, `/tiers/{id}` | — | List/create tiers + pricing; tier detail. ✅ |
| `PATCH` | `/tiers/{id}` | — | Update tier pricing / tariff override / status. ✅ |
| `POST` | `/readings` | `reading.recorded` | Persist a reading. ✅ |
| `GET` | `/subscribers/{id}/readings` | — | Reading history (staff/admin). ✅ |
| `GET` | `/me/readings` | — | The caller's own reading history (subscriber). ✅ |
| `POST` | `/billing-runs` | `invoice.issued` (×N) | Atomic monthly billing run. ✅ |
| `GET` | `/invoices`, `/invoices/{id}` | — | Invoice queries (staff/admin). ✅ |
| `GET` | `/me/invoices`, `/me/invoices/{id}` | — | The caller's own invoices (subscriber). ✅ |
| `GET` | `/invoices/{id}/payments` | — | Payments for an invoice (staff/admin). ✅ |
| `GET` | `/me/invoices/{id}/payments` | — | Payments for one invoice owned by the caller (subscriber). ✅ |
| `POST` | `/payments` | `payment.received` | Record a payment. ✅ |
| `POST` | `/outages` | `outage.scheduled` | Schedule an outage. ✅ |
| `GET` | `/outages` | — | Outage queries. ✅ |
| `GET` | `/health`, `/ready` | — | Liveness / readiness. ✅ |
| `GET` | `/actuator/health/{liveness,readiness}` | — | Spring Actuator probes. ✅ |

All requests are tenant-scoped via the operator identity forwarded by the
gateway; every query is filtered by `operatorId`.

---

## analytics-python REST — internal analytics

Base: `http://localhost:8082`. Consumed by the gateway. Read-only analytics
derived from the event stream; no domain mutations.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/analytics/collection-rate` | Collection-rate summary (paid vs. issued) per period, from `invoice.issued` + `payment.received`. ⏳ |
| `GET` | `/analytics/risk` | Tampering risk flags with reason codes; filter by `subscriberId`. ⏳ |
| `GET` | `/analytics/risk/{readingId}` | Risk detail for a single reading. ⏳ |
| `POST`| `/analytics/risk/{readingId}/label` | Operator confirm/dismiss → training label for the [continuous-learning loop](./SYSTEM_DESIGN.md#continuous-learning-loop-post-deployment). ⏳ |
| `GET` | `/health`, `/ready` | Liveness / readiness. ✅ |

This service also runs a **RabbitMQ consumer** (not an HTTP endpoint) bound to
`reading.recorded` via queue `analytics.reading-recorded` (see
`analytics-python/app/config.py`). ⏳ Phase 3.

---

## WebSocket protocol

> ⏳ Phase 4.

Endpoint: `ws://localhost:8080/api/ws`. Owned by the gateway (ADR-003);
Redis-backed fan-out (ADR-006). ⏳ Phase 4.

- **Connect & authenticate.** The client connects with its JWT (via
  `Authorization` header or a `?token=` query param on upgrade). The gateway
  verifies it and binds the socket to `(operatorId, subscriberId, role)`.
  Invalid/missing tokens are rejected at upgrade.
- **Message envelope** (both directions):
  ```json
  { "type": "<message-type>", "data": { ... }, "ts": "2026-01-01T00:00:00Z" }
  ```

### Client → server
| `type` | `data` | Meaning |
| ------ | ------ | ------- |
| `subscribe` | `{ "channels": ["outages", "invoices", "alerts"] }` | Opt into channels permitted for the role. |
| `ping` | `{}` | Keep-alive. |

### Server → client
| `type` | `data` | Source | Audience |
| ------ | ------ | ------ | -------- |
| `outage.countdown` | `{ "outageId", "startsAt", "endsAt", "secondsRemaining" }` | `outage.scheduled` + timer | subscriber |
| `invoice.ready` | `{ "invoiceId", "amountUsd", "amountLbp", "periodEnd" }` | `invoice.issued` | subscriber |
| `tampering.alert` | `{ "subscriberId", "readingId", "reason", "score" }` | `reading.flagged` (analytics→gateway) | operator |
| `unauthorized` | `{ "channel", "reason" }` | server (rejected subscribe) | any |
| `pong` | `{}` | — | any |

The gateway obtains the tampering signal from the `reading.flagged` event that
`analytics-python` publishes (see [`contracts/asyncapi.yaml`](../contracts/asyncapi.yaml)).
Channel access is role-gated and **server-enforced** against the socket's bound
`(operatorId, subscriberId, role)` — a disallowed `subscribe` gets an
`unauthorized` reply, and fan-out is never driven by the client's requested
channel alone: subscribers receive only their own
`outage.countdown` / `invoice.ready`; operators receive `tampering.alert` for
their tenant.

---

## Asynchronous events

> ✅ **Defined** in [`contracts/events`](../contracts/events).

Published by `core-java` to the RabbitMQ topic exchange `ishtirak.events`
(ADR-002). The schemas in [`contracts/events`](../contracts/events) are the
**source of truth** — reproduced here for reference. All events share the
envelope:

| Field | Type | Notes |
| ----- | ---- | ----- |
| `eventId` | uuid | unique per emission (idempotency key) |
| `eventType` | string | equals the routing key |
| `operatorId` | uuid | tenant scope |
| `occurredAt` | date-time | UTC |
| `payload` | object | per-event (below) |

### `reading.recorded` — [schema](../contracts/events/reading-recorded.schema.json)
Producer: `core-java` · Consumers: `analytics-python`. Emitted when a meter
reading is ingested.
```jsonc
"payload": {
  "readingId":    "uuid",
  "subscriberId": "uuid",
  "kwh":          0.0,          // cumulative meter value (>= 0)
  "readingAt":    "date-time"
}
```

### `invoice.issued` — [schema](../contracts/events/invoice-issued.schema.json)
Producer: `core-java` (billing run) · Consumers: `gateway-node` (WS push),
`analytics-python` (collection rate).
```jsonc
"payload": {
  "invoiceId":    "uuid",
  "subscriberId": "uuid",
  "periodStart":  "date",
  "periodEnd":    "date",
  "amountUsd":    0.0,          // >= 0
  "amountLbp":    0,            // >= 0
  "kwhConsumed":  0.0           // >= 0
}
```

### `payment.received` — [schema](../contracts/events/payment-received.schema.json)
Producer: `core-java` · Consumers: `analytics-python`. Emitted when a payment is
recorded against an invoice.
```jsonc
"payload": {
  "paymentId":    "uuid",
  "invoiceId":    "uuid",
  "subscriberId": "uuid",
  "currency":     "USD",        // USD | LBP
  "tenderedAmount": 0.0,        // >= 0
  "appliedUsd":   0.0,          // >= 0
  "appliedLbp":   0,            // >= 0
  "method":       "CASH"        // CASH | WHISH
}
```

### `outage.scheduled` — [schema](../contracts/events/outage-scheduled.schema.json)
Producer: `core-java` · Consumers: `gateway-node` (WS countdown). Emitted when an
operator schedules a load-shedding window.
```jsonc
"payload": {
  "outageId": "uuid",
  "startsAt": "date-time",
  "endsAt":   "date-time",
  "reason":   "FUEL"           // FUEL | MAINTENANCE | GRID | OTHER
}
```

Consumers must be **idempotent** (dedupe on `eventId`) and tenant-scope all
derived state by `operatorId` — see
[event-driven design](./SYSTEM_DESIGN.md#event-driven-design).

> Besides these four core-java domain events, `analytics-python` publishes one
> internal signal — **`reading.flagged`** — consumed by the gateway to drive the
> `tampering.alert` WebSocket push. It is a first-class event schema in
> [`contracts/events/reading-flagged.schema.json`](../contracts/events/reading-flagged.schema.json)
> and AsyncAPI references it directly.
