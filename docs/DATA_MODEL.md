# Data Model

> **Scope.** This document is the field-level reference for every contract,
> data-transfer object, and data object in Ishtirak — what each contains, who
> owns it, and how data flows between services. For **static structure**
> (services, tech choices, ADRs) see [`ARCHITECTURE.md`](./ARCHITECTURE.md);
> for **runtime behaviour** (flows, the theft pipeline) see
> [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md); for the **API surface** see
> [`API.md`](./API.md); for the build-out plan see [`ROADMAP.md`](./ROADMAP.md).
> The machine-readable source of truth is [`../contracts/`](../contracts)
> (event JSON Schemas, OpenAPI 3.1, AsyncAPI).
>
> **Status legend:** ✅ built · ⏳ planned. All four services are built and
> committed through **Phase 6** (gateway BFF + JWT + REST proxy + WebSocket,
> web operator dashboard + subscriber portal, and Phase-6 hardening: HttpOnly
> refresh cookies, credentialed CORS, refresh-token revocation, consumer
> DLQ/retry). The remaining ⏳ items below are post-v1 (the IsolationForest ML
> model and the operator-label retraining loop).
>
> **Two layers of "data object."** This doc distinguishes:
> - **Contract** shapes — the authoritative payloads defined in
>   `contracts/` that cross service boundaries (events + REST/OpenAPI schemas).
>   Changing these is a cross-service API change.
> - **Internal** data objects — service-local (Java records/DTOs, Python
>   Pydantic models/dataclasses, TS types). They mirror the contracts but may
>   carry extra internal fields (e.g. `operatorId`, capture-store metadata).

---

## The product in brief

A **multi-tenant SaaS** for Lebanon's neighborhood diesel-generator operators.
Each *operator* (the tenant) enrolls *subscribers* onto amperage *tiers*,
records cumulative-kWh meter *readings*, runs *monthly billing* (dual USD/LBP
currency), records *payments*, and schedules *load-shedding outages*. A
streaming *analytics* service watches the reading stream and flags meter
*tampering/theft*; a real-time layer pushes outage countdowns and alerts to
subscribers/operators over WebSocket.

**Feature set (target v1 + post-v1):**

- **Tenancy & RBAC** — every row scoped to `operatorId`; roles
  `OPERATOR_ADMIN`, `OPERATOR_STAFF`, `SUBSCRIBER`.
- **Subscriber & tier management** — amperage tiers carry dual-currency
  pricing + an optional tariff-policy override.
- **Meter readings** — cumulative-kWh ingestion → `reading.recorded` event.
- **Billing run** — atomic, per-period invoice generation from reading deltas;
  `FLAT` / `METERED` / `HYBRID` tariffs; `HALF_UP` rounding (USD 2dp, LBP whole).
- **Payments** — tendered in USD or LBP, cross-currency reconciled via the
  invoice ratio; methods `CASH` / `WHISH`.
- **Load-shedding outages** — scheduled windows with reason codes.
- **Theft detection** — explainable rules engine now; IsolationForest ML later.
- **Real-time push** — outage countdowns, "bill ready", tampering alerts (WS).
- **Analytics** — collection-rate summaries + queryable risk flags.
- **Continuous learning (post-v1)** — capture store + operator labels →
  retraining loop.

### Service ownership

| Service | Stack | Owns | Port | Built |
| --- | --- | --- | --- | --- |
| `core-java` | Java 21, Spring Boot 3.2, JPA, Spring Security, Flyway, PostgreSQL | System of record; sole domain-event publisher; token issuer | 8081 | ✅ |
| `analytics-python` | Python 3.12, FastAPI, Pydantic v2, aio-pika, Redis (+SQLite capture) | Derived: theft-risk scores, capture store for retraining | 8082 | ✅ |
| `gateway-node` | Node 20, Express 5, TS, `ws`, `amqplib`, `ioredis`, `jsonwebtoken` | Stateless BFF: JWT verify, aggregation, WebSocket fan-out | 8080 | ✅ |
| `web` | React 19, Vite, TS | Browser client (operator dashboard + subscriber portal) | 3000 | ✅ |

---

## Shared event envelope (`contracts/events`)

All asynchronous integration goes through the RabbitMQ topic exchange
**`ishtirak.events`**. Every event shares one envelope (JSON Schema draft
2020-12; `additionalProperties: false` on envelope and payload):

| Field | Type | Purpose |
| --- | --- | --- |
| `eventId` | uuid | unique per emission — **idempotency key** (consumers dedupe) |
| `eventType` | string | equals the routing key (e.g. `reading.recorded`) |
| `operatorId` | uuid | tenant scope — consumers must filter by this |
| `occurredAt` | date-time (UTC) | when the domain fact happened |
| `payload` | object | event-specific (below) |

### The six events

Five are published by `core-java`; `reading.flagged` is published by
`analytics-python`.

| Event | Producer → Consumer(s) | Payload fields |
| --- | --- | --- |
| `reading.recorded` | core-java → analytics | `readingId` uuid, `subscriberId` uuid, `kwh` number ≥0, `readingAt` date-time |
| `invoice.issued` | core-java → analytics, gateway | `invoiceId` uuid, `subscriberId` uuid, `periodStart` date, `periodEnd` date, `amountUsd` number ≥0, `amountLbp` integer ≥0, `kwhConsumed` number ≥0 |
| `invoice.status.changed` | core-java → gateway | `invoiceId` uuid, `subscriberId` uuid, `periodStart` date, `periodEnd` date, `status` `NEEDS_REVIEW`\|`VOID` — emitted when an invoice changes state **without** becoming a ready bill (held for review, voided) |
| `payment.received` | core-java → analytics | `paymentId` uuid, `invoiceId` uuid, `subscriberId` uuid, `currency` `USD`\|`LBP`, `tenderedAmount` number ≥0, `appliedUsd` number ≥0, `appliedLbp` integer ≥0, `method` `CASH`\|`WHISH` |
| `outage.scheduled` | core-java → gateway | `outageId` uuid, `startsAt` date-time, `endsAt` date-time, `reason` `FUEL`\|`MAINTENANCE`\|`GRID`\|`OTHER` |
| `reading.flagged` | analytics → gateway | `readingId` uuid, `subscriberId` uuid, `reason` `NEGATIVE_DELTA`\|`ZERO_DELTA`\|`DROP_GT_THRESHOLD`\|`EXCEEDS_TIER_CAP`\|`ML_ANOMALY`, `score` number 0–1. `ML_ANOMALY` is reserved in the contract for the post-v1 model; the current rules engine never emits it |

---

## `core-java` — system of record

Three layers: **immutable domain records** → **JPA entities** (persistence) →
**DTOs** (API boundary). Conversion via `toDomain()` (entity→record) and `from()`
factories (record→response DTO). No Lombok — plain Java records + Jakarta
Bean Validation. Every entity carries `operatorId`; every query filters by it.

### Domain records (`domain/`)

| Record | Fields |
| --- | --- |
| `Subscriber` | `id`, `operatorId`, `name`, `tierId`, `meterId`, `status`, `createdAt` |
| `Tier` | `id`, `operatorId`, `name`, `amperage`, `tariffPolicyOverride`, `standingFeeUsd`, `standingFeeLbp`, `perKwhRateUsd`, `perKwhRateLbp`, `status` |
| `Reading` | `id`, `operatorId`, `subscriberId`, `kwh`, `readingAt` |
| `Invoice` | `id`, `operatorId`, `subscriberId`, `periodStart`, `periodEnd`, `amountUsd`, `amountLbp`, `kwhConsumed`, `status`, `issuedAt` |
| `Payment` | `id`, `operatorId`, `invoiceId`, `subscriberId`, `currency`, `tenderedAmount`, `appliedUsd`, `appliedLbp`, `method`, `receivedAt` |
| `Outage` | `id`, `operatorId`, `startsAt`, `endsAt`, `reason`, `createdAt` |
| `OperatorBillingSettings` | `operatorId`, `defaultTariffPolicy` |

### Persistence entities (`persistence/`)

Each domain record has a matching `*Entity` (same fields, `@Enumerated(STRING)`
enums) with a `toDomain()` method. Entities **not** mirrored 1:1 above:

| Entity | Fields / notes |
| --- | --- |
| `OperatorEntity` | `id`, `name`, `defaultTariffPolicy`, `createdAt` (`toDomain()` → `OperatorBillingSettings`) |
| `UserEntity` | `id`, `email` (unique), `passwordHash` (BCrypt), `displayName`, `status`, `createdAt` |
| `OperatorMembershipEntity` | `id`, `userId`, `operatorId`, `role`, `subscriberId` (nullable — only for `SUBSCRIBER`), `status`, `createdAt` — unique `(userId, operatorId, role, subscriberId)` |
| `RefreshTokenEntity` | `id`, `userId`, `membershipId`, `tokenHash` (unique), `familyId`, `issuedAt`, `expiresAt`, `usedAt`, `revokedAt` — single-use rotation + family revocation |
| `BillingRunEntity` | `id`, `operatorId`, `idempotencyKey`, `periodStart`, `periodEnd`, `invoiceCount`, `createdAt`, `invoiceIds` (`@ElementCollection`) — unique `(operatorId, idempotencyKey)` |
| `InvoiceEntity` | adds `version` (`@Version` optimistic lock) |
| `OutboxEventEntity` | `id`, `eventType`, `operatorId`, `occurredAt`, `payload` (JSON), `attempts`, `nextAttemptAt`, `publishedAt`, `lastError`, `createdAt` — the **transactional outbox** |

**Unique constraints / indexes of note:** `readings` unique
`(operatorId, subscriberId, readingAt)`; `invoices` unique
`(operatorId, subscriberId, periodStart, periodEnd)`; enum columns carry
`CHECK` constraints; `outbox_events` indexed on
`(publishedAt, nextAttemptAt, createdAt)` for the pending-publish scan.

### Enums (`domain/`)

| Enum | Values |
| --- | --- |
| `ActorRole` | `OPERATOR_ADMIN`, `OPERATOR_STAFF`, `SUBSCRIBER` |
| `ResourceStatus` | `ACTIVE`, `INACTIVE` |
| `TariffPolicy` | `FLAT`, `METERED`, `HYBRID` |
| `InvoiceStatus` | `ISSUED`, `PARTIAL`, `PAID`, `VOID`, `NEEDS_REVIEW` (held when consumption can't be computed — missing reading / negative delta; operator must reissue or void) |
| `CurrencyCode` | `USD`, `LBP` |
| `PaymentMethod` | `CASH`, `WHISH` |
| `OutageReason` | `FUEL`, `MAINTENANCE`, `GRID`, `OTHER` |

### Request DTOs (Bean-validated)

| DTO | Fields |
| --- | --- |
| `LoginRequest` | `email` (@Email), `password` |
| `SelectContextRequest` | `selectionToken`, `membershipId` |
| `RefreshRequest` | `refreshToken` |
| `CreateSubscriberRequest` | `name`, `tierId`, `meterId?` |
| `UpdateSubscriberRequest` | `name?`, `tierId?`, `status?` (at least one required; `PATCH /subscribers/{id}`) |
| `TierInput` | `name`, `amperage` (@Min 1), `tariffPolicyOverride?`, `standingFeeUsd`, `standingFeeLbp`, `perKwhRateUsd`, `perKwhRateLbp` |
| `RecordReadingRequest` | `subscriberId`, `kwh` (≥0), `readingAt` |
| `ScheduleOutageRequest` | `startsAt`, `endsAt`, `reason` |
| `BillingRunRequest` | `periodStart`, `periodEnd` |
| `RecordPaymentRequest` | `invoiceId`, `currency`, `tenderedAmount` (>0), `method` |

### Response DTOs

| DTO | Fields |
| --- | --- |
| `TokenPair` | `accessToken`, `refreshToken` |
| `MembershipView` | `membershipId`, `operatorId`, `operatorName`, `role`, `subscriberId?` |
| `LoginResult` | `contextSelectionRequired`, `selectionToken?`, `accessToken?`, `refreshToken?`, `memberships[]` |
| `SubscriberResponse` | `id`, `name`, `tierId`, `meterId`, `status`, `createdAt` |
| `TierResponse` | `id`, `name`, `amperage`, `tariffPolicyOverride?`, `effectiveTariffPolicy`, `standingFeeUsd`, `standingFeeLbp`, `perKwhRateUsd`, `perKwhRateLbp`, `status` |
| `ReadingResponse` | `id`, `subscriberId`, `kwh`, `readingAt` |
| `OutageResponse` | `id`, `startsAt`, `endsAt`, `reason`, `createdAt` |
| `OutageScheduledResponse` | `outageId`, `startsAt`, `endsAt`, `reason` |
| `BillingRunResponse` | `issuedCount` (payable ISSUED invoices), `needsReviewCount` (held for review), `periodStart`, `periodEnd` |
| `InvoiceResponse` | `id`, `subscriberId`, `periodStart`, `periodEnd`, `amountUsd`, `amountLbp`, `kwhConsumed`, `status`, `issuedAt` |
| `PaymentResponse` | `id`, `invoiceId`, `subscriberId`, `currency`, `tenderedAmount`, `appliedUsd`, `appliedLbp`, `method`, `receivedAt` |
| `PageResponse<T>` | `data: List<T>`, `meta: PageMeta{total, page, limit}` |
| `ApiError` | `error: { code, message, details: [{field, issue}] }` |

### Event publishing — transactional outbox

`EventEnvelope`{`eventId`, `eventType`, `operatorId`, `occurredAt`,
`payload`} → `OutboxService.enqueue()` writes an `OutboxEventEntity` row **in
the same DB transaction** as the owning domain change → `OutboxPublisher`
polls on a configurable interval (`ishtirak.outbox.publish-delay-ms`, default
1000ms), locks pending rows (`FOR UPDATE SKIP LOCKED`), validates each
payload against its JSON Schema via `EventContractValidator`, publishes to
`ishtirak.events` (routing key = `eventType`), then `markPublished()` or
schedules a retry with backoff. This is why committed state is never lost and
rolled-back state never emits.

### Controllers

`/auth` (login / select-context / refresh / **logout** — logout revokes the
whole refresh-token family), `/subscribers` (incl. **`PATCH /subscribers/{id}`**),
`/tiers`, `/readings` + `/subscribers/{id}/readings` + `/me/readings`,
`/billing-runs` + `/invoices` + **`/invoices/{id}/reissue`** +
**`/invoices/{id}/void`** + `/invoices/{id}/payments`, `/me/invoices` +
`/me/invoices/{id}` + `/me/invoices/{id}/payments`, `/payments`, `/outages`,
`/health`, `/ready`, `/actuator/health/{liveness,readiness}`. Identity is
injected as a `RequestIdentity`{`operatorId`, `role`, `subscriberId?`} built
from the gateway headers.

---

## `analytics-python` — detection & derived data

Configuration is a frozen `Settings` dataclass (fail-fast at boot):
`rabbitmq_url`, `redis_url`, `core_java_url`, `capture_db_path`,
`analytics_service_token_secret` (≥32 chars — **outbound** token signed for
core-java), `gateway_service_token_secret` (≥32 chars — **inbound** token from
the gateway, verified on the REST API), `exchange="ishtirak.events"`,
`reading_queue="analytics.reading-recorded"`, `billing_queue="analytics.billing"`,
`dead_letter_exchange="analytics.dlx"`, `dead_letter_queue="analytics.dlq"`,
`drop_threshold_pct=0.4`, `trailing_window=5`, `tier_cache_ttl_secs=3600`,
`rabbitmq_connect_max_attempts=30`, `rabbitmq_connect_retry_delay_secs=1`.

### Consumed event models (`consumer/messages.py`, Pydantic v2)

Strict (`extra="forbid"`, alias-to-camelCase), mirroring the contracts:
`ReadingRecordedEvent`/`Payload`, `InvoiceIssuedEvent`/`Payload`,
`PaymentReceivedEvent`/`Payload`. Each event has `event_id`, `event_type`,
`operator_id`, `occurred_at`, `payload`.

### Internal data objects

**Capture store** (`capture/models.py`, frozen dataclasses — back the
post-v1 retraining loop; persisted via an abstract `CaptureRepository` port
with a `SqliteCaptureRepository` adapter, WAL mode):

| Object | Fields |
| --- | --- |
| `CapturedEvent` | `event_id`, `event_type`, `operator_id`, `subscriber_id?`, `raw_json`, `captured_at` |
| `RiskFlag` (internal) | `reading_id`, `operator_id`, `subscriber_id`, `reason`, `score`, `flagged_at` |
| `AlertLabel` | `reading_id`, `operator_id`, `confirmed`, `labeled_at` (the training label) |
| `InvoiceLedgerEntry` | `invoice_id`, `operator_id`, `period_start`, `period_end`, `amount_usd`, `amount_lbp`, `paid_usd`, `paid_lbp` |
| `CollectionRate` (internal) | `operator_id`, `invoice_count`, `issued_usd`, `issued_lbp`, `paid_usd`, `paid_lbp` + computed `collection_rate_usd`/`_lbp` |

> Note the contract vs internal split: the OpenAPI `RiskFlag` served on the
> REST API carries `label` (`UNREVIEWED`/`CONFIRMED`/`DISMISSED`) and
> `scoredAt`, while the internal capture `RiskFlag` carries `operator_id` +
> `flagged_at`. Likewise the contract `CollectionRate` is a per-period
> summary (`periodStart`/`periodEnd`, `issuedUsd`/`collectedUsd`, `rate`),
> whereas the internal one is a per-operator aggregate with a separate
> `label`-style invoice count.

**Redis state** (`redis_state/`): `SubscriberState`{`previous_kwh`,
`previous_reading_at`, `trailing_deltas`} keyed
`analytics:state:{op}:{sub}`; `TierInfo`{`amperage`} keyed
`analytics:tier:{op}:{sub}` (TTL'd).

**Rules engine** (`rules/`): `FeatureVector`{`delta?`, `drop_pct?`,
`tier_max_kwh?`, `elapsed_hours?`} → `RuleResult`{`reason`, `score`}. Four
rules with fixed scores — `NEGATIVE_DELTA`=1.0, `ZERO_DELTA`=0.8,
`EXCEEDS_TIER_CAP`=0.75, `DROP_GT_THRESHOLD`=0.65 (threshold from
`drop_threshold_pct`) — and `apply_rules()` returns the highest-scoring fired
rule.

**Publisher** (`publisher/reading_flagged.py`): `build_reading_flagged(...)`
builds the `reading.flagged` envelope; `ReadingFlaggedPublisher` validates it
against the schema and publishes. Pipelines `ReadingPipeline`{redis,
capture_repo, core_client, publisher, settings} and `BillingPipeline`{capture_repo}
orchestrate consumption.

**Consumer reliability** (`consumer/`): each queue is bound with a dead-letter
exchange (`analytics.dlx`, fanout) feeding `analytics.dlq` (capped at 10k
messages). Poison messages (parse/validation errors) dead-letter immediately;
transient failures are requeued **once** and then dead-lettered. The initial
broker connect is retried (`rabbitmq_connect_max_attempts` ×
`rabbitmq_connect_retry_delay_secs`).

**Two service tokens** (HS256, distinct secrets):
- *Outbound* — `CoreJavaClient` calls core-java with a token it signs
  (`{iss:"analytics-python", aud:"core-java", typ:"service", exp, operatorId,
  role}`, role fixed to `OPERATOR_STAFF`) to fetch a subscriber's tier amperage.
- *Inbound* — the analytics REST API verifies a **gateway-signed** token
  (`{iss:"gateway-node", aud:"analytics-python", typ:"service", exp, operatorId,
  role}`, `service_token_verifier.py`); every query is scoped to its
  `operatorId`.

**REST API** (`analytics/router.py`, served to the gateway, source of truth
`contracts/openapi/analytics-python.openapi.yaml`):

| Endpoint | Returns |
| --- | --- |
| `GET /analytics/collection-rate?periodStart&periodEnd` | list of per-period `CollectionRate` summaries |
| `GET /analytics/risk?subscriberId&minScore&page&limit` | paginated `RiskFlag` list (`{data, meta:{total,page,limit}}`) |
| `GET /analytics/risk/{readingId}` | a single `RiskFlag` (404 if absent) |
| `POST /analytics/risk/{readingId}/label` | sets the training label (`{label: CONFIRMED\|DISMISSED}`) → updated `RiskFlag` |

---

## `gateway-node` — BFF / API gateway

A stateless Express 5 + TS BFF. Configuration is a frozen, zod-validated
`Config` (`config.ts`, fail-fast at boot): `PORT`, `CORE_JAVA_URL`,
`ANALYTICS_URL`, `RABBITMQ_URL`, `REDIS_URL`, `JWT_SECRET` (≥32),
`GATEWAY_SERVICE_TOKEN_SECRET` (≥32 — for core-java tokens),
`GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET` (≥32 — for analytics tokens),
`SERVICE_TOKEN_TTL_SECS` (default 300), `WEB_ORIGIN` (credentialed-CORS origin,
default `http://localhost:3000`), `COOKIE_SECURE` (default true),
`REFRESH_COOKIE_MAX_AGE_SECS` (default 2592000 = 30 days), `AUTH_RATE_LIMIT`
(default 10/60s), `RABBITMQ_CONNECT_MAX_ATTEMPTS`/`RABBITMQ_CONNECT_RETRY_DELAY_MS`.

- **Auth** (`auth/`): `jwtVerify` verifies the HS256 access token minted by
  core-java; `serviceToken` mints **gateway-signed** HS256 service tokens with
  two distinct secrets (one audience `core-java`, one `analytics-python`);
  `cookies` manages the HttpOnly refresh cookie (`SameSite`, `Secure` per
  `COOKIE_SECURE`, scoped to `/api/auth`); `rbac` enforces role per route.
- **REST proxy** under `/api/*` (`proxy/`): auth routes
  (`/api/auth/{login,select-context,refresh,logout}`); core routes
  (`/api/subscribers`, `/api/tiers`, `/api/readings`, `/api/billing-runs`,
  `/api/invoices` + `…/reissue|void|payments`, `/api/payments`, `/api/outages`,
  `/api/me/*`); analytics routes (`/api/analytics/collection-rate`,
  `/api/analytics/risk*`). Each request is zod-validated, then `forward`
  re-signs a service token and injects internal identity headers
  `x-operator-id`, `x-actor-role`, `x-actor-subscriber-id`.
- **Logout / revocation**: clears the refresh cookie and makes a best-effort
  call to core-java to revoke the refresh-token family; revocation failure never
  blocks the response.
- **Rate limiting** (`rateLimit.ts`, Redis-backed): tight limit on auth routes
  (`AUTH_RATE_LIMIT`), broader limit on the rest of `/api`.
- **Events → WebSocket** (`events/`, `ws/`): a RabbitMQ consumer subscribes to
  `outage.scheduled`, `invoice.issued`, `invoice.status.changed`, and
  `reading.flagged`, with a dead-letter exchange/queue (`gateway.ws-fanout.dlx`
  / `.dlq`, capped) and a single-retry policy. Matching events fan out over
  WebSocket via Redis (`ws/fanout.ts`, `socketRegistry.ts`).

## `web` — operator dashboard + subscriber portal

A React 19 + Vite + TS SPA (`react-router-dom`). All DTOs are `Readonly`
TS types in `web/src/lib/types.ts` mirroring the core/analytics contracts:
`Role`, `Status`, `TariffPolicy`, `Currency`, `PageMeta`, `Paginated<T>`,
`ApiErrorBody`, `Membership`, `Identity`, `LoginResult`, `Tier`, `Subscriber`,
`Reading`, `Invoice` (`InvoiceStatus` includes `NEEDS_REVIEW`), `Payment`,
`Outage`, `RiskFlag`, `CollectionRate`, plus `WsChannel`/`WsEvent`.

- **Auth** (`auth/`): `AuthContext` (login / selectContext / logout /
  refreshMe), a `LoginPage` + `ContextSelectPage` (the multi-membership
  context-selection flow), `RequireRole` route guard, and an in-memory
  `TokenStore` for the short-lived access token (the refresh token lives only in
  the gateway's HttpOnly cookie).
- **Operator** (`operator/`, roles `OPERATOR_ADMIN`/`OPERATOR_STAFF`):
  `SubscribersPage` + `SubscriberDetailPage`, `TiersPage`, `ReadingsPage`,
  `BillingRunPage`, `InvoicesPage` + `InvoiceDetailPage`, `OutagesPage`,
  `AnalyticsPage`.
- **Subscriber** (`subscriber/`, role `SUBSCRIBER`): `CurrentBillPage`,
  `ConsumptionHistoryPage`, `OutageCountdown`.
- **Hooks**: `useWebSocket`, `usePaginated`, `useFetch`, `useCountdown`;
  `DataState` for loading/error rendering.

---

## Cross-cutting data shapes

- **Pagination** — `{ data: [...], meta: { total, page, limit } }`
  (`PageResponse<T>` / OpenAPI `PageMeta`); `?page` is 1-based, `?limit`
  default 20, max 100.
- **Error envelope** — `{ error: { code, message, details: [{field, issue}] } }`.
  `details[].issue` is user-safe only (no stack traces / SQL). Codes →
  400 / 401 / 403 / 404 / 409 / 429 / 500.
- **WebSocket envelope** — `{ type, data, ts }`. Server→client (6 types):
  `outage.countdown`, `invoice.ready`, `invoice.updated` (status →
  `NEEDS_REVIEW`/`VOID`), `tampering.alert`, `unauthorized`, `pong`.
  Client→server: `subscribe` (channels `outages`/`invoices`/`alerts`), `ping`.
- **Auth / trust boundary** — two OpenAPI security schemes: `bearerAuth`
  (browser JWT, verified by the gateway) and `gatewayServiceAuth` (a
  gateway-signed **service** token for internal calls — never the raw browser
  JWT). Internal identity flows as gateway-injected headers `X-Operator-Id`,
  `X-Actor-Role`, and `X-Actor-Subscriber-Id` (required when role is
  `SUBSCRIBER`); the service-token claims must match them, and every internal
  query filters by `X-Operator-Id`.

---

## Diagram A — domain entity relationships

Everything hangs off `operatorId` (the tenant). Tree = ownership hierarchy;
notes show cross-links.

```
OPERATOR  (tenant)   [id, name, defaultTariffPolicy, createdAt]
│                     └─ OperatorBillingSettings{operatorId, defaultTariffPolicy}
│
├─── USER            [id, email(unique), passwordHash, displayName, status, createdAt]
│    └─── OPERATOR_MEMBERSHIP   [id, userId, operatorId, role, subscriberId?, status]
│         │   role ∈ {OPERATOR_ADMIN, OPERATOR_STAFF, SUBSCRIBER}
│         │   subscriberId set ONLY when role = SUBSCRIBER
│         └─── REFRESH_TOKEN    [id, membershipId, tokenHash, familyId,
│                                issuedAt, expiresAt, usedAt, revokedAt]   single-use, family revocation
│
├─── TIER            [id, name, amperage, tariffPolicyOverride,
│    │                standingFeeUsd/Lbp, perKwhRateUsd/Lbp, status]
│    └──  ◄──  SUBSCRIBER.tierId          (a subscriber picks ONE tier)
│
├─── SUBSCRIBER      [id, name, tierId, meterId, status, createdAt]
│    ├── READING     [id, subscriberId, kwh, readingAt]                    unique(op,sub,readingAt)
│    ├── INVOICE     [id, subscriberId, periodStart/End, amountUsd/Lbp,
│    │   │            kwhConsumed, status, issuedAt, version(@Version)]    unique(op,sub,period)
│    │   └── PAYMENT [id, invoiceId, subscriberId, currency, tenderedAmount,
│    │                appliedUsd/Lbp, method, receivedAt]
│    └── PAYMENT     (denormalized subscriberId FK, for tenant scoping)
│
├─── OUTAGE          [id, startsAt, endsAt, reason, createdAt]
└─── BILLING_RUN     [id, idempotencyKey, periodStart/End, invoiceCount, invoiceIds[]]
                                                                       unique(op, idempotencyKey)

Cross-cutting (not domain-owned):
  OUTBOX_EVENT  [eventType, operatorId, occurredAt, payload(JSON), attempts,
                 nextAttemptAt, publishedAt, lastError]   ← written in SAME txn as the domain change
```

**Cardinalities:** Operator 1─< *{User, Tier, Subscriber, Outage, BillingRun} ·
User 1─< *Membership 1─< *RefreshToken · Tier 1─< *Subscriber ·
Subscriber 1─< *{Reading, Invoice} · Invoice 1─< *Payment.

---

## Diagram B — service + event topology

```
                         ┌────────────────────────────────┐
                         │           web :3000            │
                         │  operator dashboard            │
                         │  + subscriber portal           │
                         └────────┬──────────────┬────────┘
                            REST  │              │ WS
                                  ▼              ▼
   ┌────────────────────────────────────────────────────────────────┐
   │                     gateway-node :8080                         │
   │   verify browser JWT → derive operatorId + role                │
   │   REST aggregate/proxy        WebSocket fan-out (Redis)        │
   │   mint+sign SERVICE token; inject X-Operator-Id / X-Actor-Role │
   └──────┬──────────────────────────────────────────┬─────────────┘
          │ service token + X-Operator-Id             │ WS: outage.countdown,
          │                                           │     invoice.ready, tampering.alert
   ┌──────▼──────────────┐          ┌─────────────────▼──────────────┐
   │ core-java :8081     │          │ analytics-python :8082          │
   │ SYSTEM OF RECORD    │          │ consumer + rules + capture      │
   │ Postgres + Flyway   │          │ + REST API (risk, collection)   │
   │ RBAC, billing,      │          │ SQLite(WAL) capture store       │
   │ payments, outbox    │          │ Redis rolling state + tier cache│
   │ TOKEN ISSUER        │          │                                 │
   └────────┬────────────┘          └──────────┬──────────────────────┘
            │                                  │
            │  publishes 5 events              │  consumes 3 + publishes 1
            │  via transactional outbox        │
            ▼                                  │
   ╔═══════════════════════════════════════════▼══════════════════════╗
   ║   RabbitMQ   topic exchange   ishtirak.events                    ║
   ║                                                                  ║
   ║   core-java  ─► reading.recorded        ─► analytics             ║
   ║   core-java  ─► invoice.issued          ─► analytics, gateway    ║
   ║   core-java  ─► invoice.status.changed  ─► gateway               ║
   ║   core-java  ─► payment.received         ─► analytics            ║
   ║   core-java  ─► outage.scheduled         ─► gateway              ║
   ║   analytics  ─► reading.flagged          ─► gateway  (risk)      ║
   ╚══════════════════════════════════════════════════════════════════╝

   Stores:   PostgreSQL :5432  ← core-java (sole owner)
             Redis :6379       ← gateway (WS fan-out) + analytics (rolling reading state, tier cache)
             SQLite (WAL)      ← analytics capture store (single-writer → migrate to Postgres later)
```

---

## Event → side-effect

| Event | Consumer → what it does |
| --- | --- |
| `reading.recorded` | analytics → load Redis rolling state, extract `FeatureVector`, run rules, write capture, emit `reading.flagged` if a rule fires |
| `invoice.issued` | gateway → WS `invoice.ready` to subscriber · analytics → upsert invoice ledger, recompute collection rate |
| `invoice.status.changed` | gateway → WS `invoice.updated` (status → `NEEDS_REVIEW`/`VOID`) to the affected subscriber/operator |
| `payment.received` | analytics → add payment to ledger (cross-currency), recompute collection rate |
| `outage.scheduled` | gateway → store countdown in Redis, stream live `outage.countdown` ticks to affected subscribers |
| `reading.flagged` | gateway → WS `tampering.alert` to the operator |

---

## v1 "done" definition

The three [`DEMO.md`](./DEMO.md) showcase flows wired **end-to-end and green**:
(1) **billing run**, (2) **tampering catch**, (3) **load-shedding countdown** —
with CI green, ≥80% coverage per service, and all CRITICAL/HIGH review findings
resolved. See [`ROADMAP.md`](./ROADMAP.md) for the phase breakdown.
