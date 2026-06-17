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

## Phase 2 — core-java domain model + event publishing ⏳

**Scope.** Turn `core-java` into the system of record (ADR-004).
- Add deps: `spring-boot-starter-data-jpa`, `org.postgresql:postgresql`,
  `flyway-core`, `spring-boot-starter-amqp`, `spring-boot-starter-security`.
- Flyway migrations for: operators, users/roles, tiers, subscribers, readings,
  invoices, payments, outages (all carrying `operatorId`).
- Feature packages (entities, repositories, services, controllers, DTOs) for
  subscribers, tiers, readings, billing, payments, outages — see
  [API.md › core-java REST](./API.md#core-java-rest--internal-system-of-record).
- The **billing run**: compute `kwhConsumed` deltas and issue invoices in **one
  transaction** (confirm the [billing formula](./SYSTEM_DESIGN.md#billing-model-assumption--confirm-at-phase-2) first).
- RBAC + JWT issuance (Spring Security); enforce `operatorId` scoping on every
  query.
- Domain event publisher → `ishtirak.events`, emitting **after commit**, payloads
  validated against the contracts.

**Testing.** Unit (services, billing math, scoping); integration with
**Testcontainers** (Postgres + RabbitMQ) for repositories, the transactional
billing run, and event emission; contract tests for each event payload.
**Security review** required (RBAC, tenancy, payments).

**Exit criteria.** Domain CRUD + billing run + payments work against Postgres;
all four events are emitted with valid payloads; tenant isolation enforced and
tested; coverage ≥ 80%; reviews clean.

---

## Phase 3 — analytics consumer + rules-based detection + capture writer ⏳

**Scope.** Wire the consumer marked at `analytics-python/app/main.py` and ship
explainable detection (ADR-005).
- aio-pika consumer bound to `reading.recorded` (queue `analytics.reading-recorded`).
- **Rule engine** (Phase 3a): features (kWh delta, drop vs. trailing average,
  consumption vs. tier amperage cap, zero/negative delta) → risk flag + reason
  code; per-subscriber rolling state in Redis. See
  [theft-detection pipeline](./SYSTEM_DESIGN.md#theft-detection-pipeline-rules-first).
- Analytics REST: collection-rate + risk endpoints
  ([API.md](./API.md#analytics-python-rest--internal-analytics)).
- **Capture *writer*** (ADR-007): persist every consumed event + operator alert
  labels to a SQLite (WAL) store behind a repository interface (+ Docker volume).
  This only *records* data for later retraining — **the v1 model cold-starts**;
  no retraining happens here.

**Testing.** Unit (feature extraction, each rule, idempotent dedupe on
`eventId`); integration (consume a published `reading.recorded` end-to-end via
Testcontainers RabbitMQ + capture write); contract tests on the consumed
payload. **Security review** for input handling + tenancy.

**Exit criteria.** Anomalous readings raise an explainable risk flag; analytics
endpoints serve summaries; capture store records events + labels; idempotent
under redelivery; coverage ≥ 80%.

---

## Phase 4 — gateway aggregation/proxy + JWT + WebSocket ⏳

**Scope.** Implement the BFF behind the Phase-4 markers in `app.ts`/`server.ts`.
- JWT verification middleware (`jsonwebtoken`); derive `operatorId`/role, forward
  inward (ADR-003).
- REST aggregation/proxy to core-java + analytics for the
  [public API](./API.md#gateway-bff--public-api).
- WebSocket server (`ws`) with JWT-authenticated handshake; RabbitMQ consumer
  (`amqplib`) for `outage.scheduled` + `invoice.issued`; Redis (`ioredis`)
  fan-out for the [WebSocket protocol](./API.md#websocket-protocol).
- Outage countdown timer + tampering-alert relay.

**Testing.** Unit (auth middleware, message mappers — extend the
`ReadinessProbe`-style injectable pattern in `app.ts`); integration (proxy +
WS push from a published event via Testcontainers); reject unauthenticated
upgrades. **Security review** required (auth boundary, WS surface, tenancy).

**Exit criteria.** Authenticated REST aggregation works; subscribers receive live
outage countdowns and bill-ready pushes; operators receive tampering alerts;
unauthenticated access rejected; coverage ≥ 80%.

---

## Phase 5 — web operator dashboard + subscriber portal ⏳

**Scope.** Replace the placeholder shell (Phase-5 marker in `App.tsx`).
- React Router routes; API client (auth/token handling) + WebSocket client with
  reconnect/backfill.
- **Operator dashboard**: subscribers, readings, billing run, invoices/payments,
  outages, analytics (collection rate, risk alerts).
- **Subscriber portal**: current bill, consumption history, live outage
  countdown.

**Testing.** Unit/component (Vitest + React Testing Library); E2E (Playwright)
covering the three [showcase flows](./SYSTEM_DESIGN.md#sequence-flows-the-three-showcase-scenarios).
**Code review** required.

**Exit criteria.** Both UIs functional against the gateway; real-time updates
render; E2E for the three flows green; coverage ≥ 80%.

---

## Phase 6 — Hardening ⏳

**Scope.** Production-readiness.
- **Observability**: metrics, tracing, structured-log aggregation across services.
- **Initial ML detection (3b, cold-start)**: add scikit-learn; IsolationForest on
  the same feature vector, complementing the rules (ADR-005).
- **Resilience**: dead-letter queues + retry/backoff for consumers; idempotency
  hardening; graceful degradation.
- **Performance**: load-test the billing run, the reading stream, and WS fan-out.
- **Security**: full `security-reviewer` sweep; secret rotation; rate limiting on
  gateway endpoints.

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
