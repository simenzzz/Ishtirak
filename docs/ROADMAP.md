# Roadmap

> **Scope.** The implementation and testing plan to take Ishtirak from today's
> Phase-1 scaffold to a working v1, plus the post-v1 operational track. Phases
> follow the markers already embedded in the code (`app.ts`, `server.ts`,
> `main.py`, `App.tsx`). For structure see [`ARCHITECTURE.md`](./ARCHITECTURE.md);
> for behaviour see [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md); for the API surface
> see [`API.md`](./API.md).

## How we work (applies to every phase)

- **TDD** (per [CLAUDE.md](../CLAUDE.md) / repo testing rules): write the failing
  test first, implement to green, refactor. Target **80%+ coverage per service**.
- **Three test layers**: unit (functions, components), integration (REST +
  DB/broker), E2E (the showcase flows end-to-end).
- **Contract tests**: validate emitted events and parsed payloads against the
  [`contracts/events`](../contracts/events) JSON Schemas, and validate REST
  request/response shapes against the [`contracts/openapi`](../contracts/openapi)
  specs (and the WebSocket messages against [`contracts/asyncapi.yaml`](../contracts/asyncapi.yaml)),
  so producers and consumers can't drift from the source of truth. CI lints the
  specs themselves (the `contracts` job).
- **Mandatory reviews**: run `everything-claude-code:code-reviewer` after any
  logic change; add `everything-claude-code:security-reviewer` for auth, RBAC,
  multi-tenant isolation, payments, user input, or event/WebSocket surface. Fix
  every CRITICAL/HIGH before declaring a phase done.
- **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs all
  four services on every push/PR and must stay green:
  core-java `mvn -B verify` · analytics `ruff check . && pytest` · gateway
  `tsc --noEmit && npm test` · web `npm run build && npm test`.
- **Conventions**: files < 300 lines, immutable objects, validate at boundaries,
  enforce `operatorId` scoping everywhere.

---

## Phase 1 — Scaffolding ✅ (done)

- [x] Repo layout, per-service skeletons that boot and answer `/health` + `/ready`.
- [x] Event contracts (`contracts/events/*.schema.json`) + shared envelope.
- [x] `infra/docker-compose.yml` wiring postgres, redis, rabbitmq + 4 services;
      `infra/.env.example`.
- [x] Per-service test suites green; CI runs all four.
- [x] These design docs (`docs/`).

---

## Phase 2 entry — open questions & deferred decisions

Carried into implementation from the design/contract phase. Resolve or
consciously confirm each before the relevant work lands.

- [x] **Billing tariff formula** — resolved for v1: operators define a default
  tariff policy (`FLAT`, `METERED`, `HYBRID`), tiers may override it, and tiers
  carry explicit USD/LBP fees and rates. Invoices carry `amountUsd` +
  `amountLbp`; payments may be tendered in either currency and reconcile using
  the invoice ratio. Rounding is `HALF_UP`: USD to 2 decimals, LBP to whole lira.
- [x] **Subscriber `{id}` access** — resolved for v1: SUBSCRIBER callers use
  `/api/me/*` projections only. By-id subscriber, invoice, reading, and payment
  endpoints are staff/admin.
- [x] **Rate limiting** — resolved for Phase 2 core-java defaults: defensive
  local throttling covers internal mutations 60/min, readings 120/min, and
  billing runs 3/hour. Login/refresh throttling remains a Phase 4 gateway
  responsibility because core sees the gateway as the network peer.
- [x] **`reading.flagged`** — resolved: promoted to
  [`contracts/events/reading-flagged.schema.json`](../contracts/events/reading-flagged.schema.json)
  and referenced directly from AsyncAPI.
- [x] **Internal identity propagation (ADR-008)** — Phase 2/4 must implement the
  `gatewayServiceAuth` service token + `X-Operator-Id`/`X-Actor-Role` injected
  headers; every core-java query filters by `X-Operator-Id`.
- [x] **AsyncAPI gotcha** — keep event message payloads as a direct `$ref`; the
  `schemaFormat: …draft-2020-12` form is rejected by the AsyncAPI parser.

## Phase 2 — core-java domain model + event publishing ✅ (done)

**Scope.** Turn `core-java` into the system of record (ADR-004).
- [x] Add deps: `spring-boot-starter-data-jpa`, `org.postgresql:postgresql`,
  `flyway-core`, `spring-boot-starter-amqp`, `spring-boot-starter-security`.
- [x] Flyway migrations for: operators, users/roles, tiers, subscribers, readings,
  invoices, payments, outages (all carrying `operatorId`).
- [x] Persistence-backed feature packages (domain records, repositories, services, controllers,
  DTOs) for subscribers, tiers, readings, billing, and payments — see
  [API.md › core-java REST](./API.md#core-java-rest--internal-system-of-record).
- [x] Add outage feature package and persistence-backed repositories.
- [x] The **billing run**: compute `kwhConsumed` deltas and issue
  dual-currency invoices using the operator/tier tariff policy.
- [x] Make the **billing run** transactional against Postgres.
- [x] RBAC + JWT issuance (Spring Security); enforce `operatorId` scoping on every
  query.
- [x] Defensive internal service-token auth + injected identity handling for
  core-java, with `operatorId` scoping on implemented queries.
- [x] Domain event publisher → `ishtirak.events` via a transactional outbox, payloads
  validated against the contracts.

**Testing.** Unit (services, billing math, scoping); integration with
**Testcontainers** (Postgres + RabbitMQ) for repositories, the transactional
billing run, and event emission; contract tests for each event payload.
**Security review** required (RBAC, tenancy, payments).

- [x] Unit/integration-style tests for billing math, service-token auth,
  subscriber self-service projections, idempotent/concurrent billing, payment
  reconciliation, and contract-safe response shapes.
- [x] OpenAPI and AsyncAPI validation pass.
- [x] Code and security reviews clean of CRITICAL/HIGH findings for the
  persistence-backed Phase 2 foundation.
- [x] Default local tests cover persistence-backed billing, payments, auth, scoping,
  and contract-safe API responses against an H2-backed Spring context.
- [x] Testcontainers smoke coverage is present for Postgres + RabbitMQ contexts.
  Run it with `./mvnw -Dtest=Phase2ContainersTest test` from `services/core-java`;
  the command fails if Docker is unavailable or misconfigured. Override Docker
  Java negotiation with `-Ddocker.api.version=<version>` if needed.

**Exit criteria.** Domain CRUD + billing run + payments work against Postgres;
all four events are emitted with valid payloads; tenant isolation enforced and
tested; coverage ≥ 80%; reviews clean.

---

## Phase 3 — analytics consumer + rules-based detection + capture writer ✅ (done)

**Scope.** Wire the consumer marked at `analytics-python/app/main.py` and ship
explainable detection (ADR-005).
- [x] aio-pika consumer bound to `reading.recorded` (queue `analytics.reading-recorded`),
  plus a billing consumer bound to `invoice.issued` + `payment.received`
  (queue `analytics.billing`).
- [x] **Rule engine** (Phase 3a): features (kWh delta, drop vs. trailing average,
  consumption vs. tier amperage cap, zero/negative delta) → risk flag + reason
  code; per-subscriber rolling state in Redis. See
  [theft-detection pipeline](./SYSTEM_DESIGN.md#theft-detection-pipeline-rules-first).
- [x] **`EXCEEDS_TIER_CAP` tier data**: tier amperage is fetched from core-java REST
  (cached in Redis with TTL) using a first-class **analytics-python service
  identity**. core-java's `ServiceTokenVerifier` now accepts a configurable map of
  trusted issuer→secret (`gateway-node`, `analytics-python`); see the ADR-008
  note below. Lookup failures raise (never silently disable the rule).
- [x] **Collection-rate**: derived by consuming `invoice.issued` + `payment.received`
  into a per-invoice ledger (payments attributed via `invoiceId`), matching the
  AsyncAPI/SYSTEM_DESIGN intent rather than synchronous REST polling.
- [x] Analytics REST: collection-rate + risk endpoints
  ([API.md](./API.md#analytics-python-rest--internal-analytics)), each scoped by
  `X-Operator-Id`.
- [x] **Capture *writer*** (ADR-007): persist every consumed event + operator alert
  labels to a SQLite (WAL) store behind a repository interface (+ Docker volume).
  This only *records* data for later retraining — **the v1 model cold-starts**;
  no retraining happens here.

**Testing.** Unit (feature extraction, each rule, idempotent dedupe on
`eventId`); integration (consume a published `reading.recorded` end-to-end via
Testcontainers RabbitMQ + capture write); contract tests on the consumed
payload. **Security review** for input handling + tenancy.

- [x] Unit tests: config validation, capture store CRUD + idempotency, Redis state +
  tier cache, every rule's boundary cases, engine priority, core-java client
  (two-call tier fetch, 404 vs error), service-token format, REST endpoints +
  operator scoping, reading.flagged contract validation, consumer dispatch +
  **redelivery idempotency** (no double publish / double-counted state).
- [x] Integration tests (Testcontainers RabbitMQ): reading → `reading.flagged`
  round-trip and billing → collection-rate; skip cleanly when Docker is absent.
- [x] core-java: `ServiceTokenVerifier` accept/reject tests for the new
  multi-issuer auth; existing suite green.
- [x] Coverage ≥ 80% (analytics ~94% incl. integration); `ruff` clean.
- [x] **Inbound analytics REST auth**: endpoints require the gateway-signed
  service token plus matching trusted identity headers.

**Exit criteria.** Anomalous readings raise an explainable risk flag; analytics
endpoints serve summaries; capture store records events + labels; idempotent
under redelivery; coverage ≥ 80%.

> **ADR-008 update (Phase 3).** Internal service auth is no longer single-issuer:
> `ServiceTokenVerifier` selects the HMAC secret by the token's `iss` claim from a
> configurable trusted-issuer map (`gateway-node` via
> `ishtirak.gateway-service-token-secret`, `analytics-python` via the optional
> `ishtirak.analytics-service-token-secret`). Analytics is a first-class internal
> peer (role `OPERATOR_STAFF`) rather than sharing the gateway's secret.

---

## Phase 4 — gateway aggregation/proxy + JWT + WebSocket ✅

**Scope.** Implement the BFF behind the Phase-4 markers in `app.ts`/`server.ts`.
- [x] JWT verification middleware (`jsonwebtoken`); derive `operatorId`/role, forward
  inward (ADR-003).
- [x] REST aggregation/proxy to core-java + analytics for the
  [public API](./API.md#gateway-bff--public-api).
- [x] WebSocket server (`ws`) with JWT-authenticated handshake using
  `Sec-WebSocket-Protocol: bearer.<token>`; RabbitMQ consumer (`amqplib`) for
  `outage.scheduled`, `invoice.issued`, and `reading.flagged`; Redis (`ioredis`)
  fan-out for the [WebSocket protocol](./API.md#websocket-protocol).
- [x] Single outage countdown push per `outage.scheduled` event; tampering-alert
  relay from `reading.flagged`.
- [x] Analytics inbound service-token auth and contract-aligned analytics REST
  shapes.
- [x] Minimal core-java `PATCH /subscribers/{id}` support so the gateway contract
  is honored end to end.

**Testing.** Unit (auth middleware, message mappers — extend the
`ReadinessProbe`-style injectable pattern in `app.ts`); integration (proxy +
WS push from a published event via Testcontainers); reject unauthenticated
upgrades. **Security review** required (auth boundary, WS surface, tenancy).

**Exit criteria.** Authenticated REST aggregation works; subscribers receive live
outage countdowns and bill-ready pushes; operators receive tampering alerts;
unauthenticated access rejected; coverage ≥ 80%.

---

## Phase 5 — web operator dashboard + subscriber portal ✅

**Scope.** Replace the placeholder shell (Phase-5 marker in `App.tsx`).
- [x] React Router routes; API client with auth/token handling and refresh retry.
- [x] WebSocket client with authenticated subprotocols, reconnect, role-channel
  subscription, and REST backfill callbacks.
- [x] **Operator dashboard**: subscribers, tiers, readings, billing run, invoices/payments,
  outages, analytics (collection rate, risk alerts).
- [x] **Subscriber portal**: current bill, consumption history, live outage
  countdown.
- [x] Tailwind v4 Vite styling, route guards, gateway-only API base URL handling,
  and **HttpOnly refresh-cookie auth**: the refresh token lives only in a
  gateway-set `ishtirak.refresh` cookie (the gateway strips it from auth response
  bodies and reads it back on refresh); the browser keeps only the short-lived
  access token in memory and re-mints it from the cookie on reload. Adds
  credentialed CORS (`WEB_ORIGIN`) on the gateway and `POST /api/auth/logout`.
  Server-side refresh revocation on logout is deferred to Phase 6 (needs a
  core-java endpoint).
- [ ] Playwright E2E for the three showcase flows is deferred to Phase 6; this
  phase covers the gate with Vitest + React Testing Library and mocked gateway/WS.

**Testing.** Unit/component/integration-style tests (Vitest + React Testing
Library) cover auth branches, role redirects, API refresh/error handling,
WebSocket subscription/parsing, countdown derivation, operator forms, live alerts,
bill-ready refresh, and subscriber history. **Code review** and **security review**
required because this phase touches auth/token handling, RBAC-gated UI, payments,
and WebSocket protocol use.

**Exit criteria.** Both UIs functional against the gateway; real-time updates
render; coverage ≥ 80%. Playwright E2E remains unchecked until Phase 6.

---

## Phase 6 — Hardening ⏳

**Scope.** Production-readiness.
- [ ] Playwright E2E for the three showcase flows from Phase 5 against the full
  docker-compose stack.
- **Observability**: metrics, tracing, structured-log aggregation across services.
- **Initial ML detection (3b, cold-start)**: add scikit-learn; IsolationForest on
  the same feature vector, complementing the rules (ADR-005).
- **Resilience**: dead-letter queues + retry/backoff for consumers; idempotency
  hardening; graceful degradation.
- **Performance**: load-test the billing run, the reading stream, and WS fan-out.
- **Security**: full `security-reviewer` sweep; secret rotation; rate limiting on
  gateway endpoints; **server-side refresh-token revocation on logout** (core-java
  endpoint, called by the gateway when clearing the cookie); and, for a
  cross-*site* web/gateway deployment, `SameSite=None; Secure` cookies plus CSRF
  protection on `POST /api/auth/refresh` (today's `SameSite=Strict` suits the
  same-site dev/intended deployment).

**Exit criteria.** Observability in place; DLQ/retry proven; ML detector deployed
alongside rules; security sweep clean.

---

## Post-v1 / operational track — Continuous learning (MLOps) ⏳

> Realized **after** the v1 demo flows are live and accumulating real production
> data. Distinct from v1 model quality (ADR-007).

- **Retraining loop**: scheduled job over the capture store (production traffic +
  operator labels) → train candidate → evaluate vs. live (precision/recall) →
  promote via **model versioning**; monitor drift/quality. See
  [continuous-learning loop](./SYSTEM_DESIGN.md#continuous-learning-loop-post-deployment).
- **Capture-store migration trigger**: when analytics scales horizontally, move
  the SQLite capture store to a separate `analytics` schema in the shared
  PostgreSQL (or a Parquet/object-store sink) — SQLite is single-writer.
- **Feedback UX**: operator confirm/dismiss on alerts (label capture) wired
  through the dashboard.

---

## v1 "done" definition

The three [`docs/DEMO.md`](./DEMO.md) showcase flows wired **end-to-end and
green**:

1. **Billing run** — operator triggers it → invoices issued atomically →
   `invoice.issued` → WS "bill ready" → collection-rate summary updates.
2. **Tampering catch** — operator records a reading → `reading.recorded` →
   analytics flags an anomaly → operator gets a real-time alert.
3. **Load-shedding countdown** — operator schedules an outage →
   `outage.scheduled` → affected subscribers see a live countdown.

…with CI green, ≥ 80% coverage per service, and all CRITICAL/HIGH review findings
resolved.
