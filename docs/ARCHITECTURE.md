# Architecture

> **Scope.** This document describes the **static structure** of Ishtirak — the
> services, their responsibilities, the technology choices, the cross-cutting
> concerns, and the decisions (ADRs) behind them. For **runtime behaviour**
> (data flows, sequence diagrams, the theft-detection pipeline, scaling and
> failure modes) see [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md). For the API
> surface see [`API.md`](./API.md); for the build-out plan see
> [`ROADMAP.md`](./ROADMAP.md).
>
> **Status legend:** ✅ built · ⏳ planned. Today **`core-java` is built through
> Phase 2** — the system of record (domain model, billing run, payments, RBAC +
> JWT, tenant scoping, and the transactional outbox event publisher) is
> implemented and tested. `analytics-python`, `gateway-node`, and `web` remain
> scaffolds that boot and answer `/health` + `/ready` (Phases 3-5). Items below
> are marked accordingly.

Ishtirak is a multi-tenant platform for Lebanon's neighborhood diesel-generator
operators. Each operator (the tenant) manages subscribers on amperage tiers,
records meter readings, runs monthly billing, records payments, and schedules
load-shedding outages. A streaming analytics service flags meter tampering /
theft from the reading stream, and a real-time layer pushes outage countdowns
and alerts to subscribers. See the [project README](../README.md) for the
product overview.

## Component view

```
                         ┌──────────────────────────────┐
                         │            web (3000)         │
                         │  React 19 + Vite + TS         │  ⏳ Phase 5
                         │  operator dashboard +         │
                         │  subscriber portal            │
                         └───────────────┬──────────────┘
                                 REST + WebSocket
                                         │
                         ┌───────────────▼──────────────┐
                         │      gateway-node (8080)      │
                         │  Express 5 + TS — BFF         │  ⏳ Phase 4
                         │  JWT verify · aggregation ·   │
                         │  WebSocket fan-out            │
                         └───┬───────────────────────┬───┘
                       REST  │                       │  REST
            ┌────────────────▼──────┐      ┌─────────▼─────────────────┐
            │     core-java (8081)  │      │   analytics-python (8082) │
            │  Spring Boot 3.2      │      │  FastAPI 3.12             │
            │  SYSTEM OF RECORD     │ ✅P2 │  theft detection +        │ ⏳P3
            │  subscribers, tiers,  │      │  operator analytics       │
            │  readings, billing,   │      │                           │
            │  payments, RBAC       │      │  capture store (SQLite)   │
            └───────┬───────────────┘      └───┬───────────────────┬───┘
                    │                          │                   │
              ┌─────▼──────┐                   │            ┌──────▼──────┐
              │ PostgreSQL │  durable store    │            │   SQLite    │ ⏳P3
              │   (5432)   │                   │            │ capture/ML  │
              └────────────┘                   │            └─────────────┘
                    │                          │
                    │  publishes               │  consumes
                    └────────►  RabbitMQ topic exchange  ◄────────┐
                               `ishtirak.events` (5672)           │
                               reading.recorded · invoice.issued  │
                               payment.received · outage.scheduled │
                                         │                         │
                                   ┌─────▼─────┐                   │
                                   │   Redis   │  ephemeral real-  │
                                   │  (6379)   │  time state /     │
                                   └───────────┘  WS fan-out ──────┘
```

Ports and wiring above are the source of truth in
[`infra/docker-compose.yml`](../infra/docker-compose.yml). RabbitMQ also exposes
its management UI on `15672`.

## Service responsibilities

| Service | Stack | Owns (data) | Publishes | Consumes | Port |
| ------- | ----- | ----------- | --------- | -------- | ---- |
| `core-java` | Java 21, Spring Boot 3.2, Spring Data JPA, Spring Security, Flyway, PostgreSQL | System of record: operators, users/roles, subscribers, tiers, readings, invoices, payments, outages | `reading.recorded`, `invoice.issued`, `payment.received`, `outage.scheduled` | — | 8081 |
| `analytics-python` | Python 3.12, FastAPI, Pydantic v2, aio-pika, Redis (+ scikit-learn later) | Derived: risk scores, capture store for retraining | — | `reading.recorded` (+ `invoice.issued`, `payment.received` for summaries) | 8082 |
| `gateway-node` | Node 20, Express 5, TypeScript, `ws`, `amqplib`, `ioredis`, `jsonwebtoken` | None (stateless BFF; Redis-backed ephemeral WS state) | — | `outage.scheduled`, `invoice.issued` (for WS pushes) | 8080 |
| `web` | React 19, Vite, TypeScript, React Router | None (browser client) | — | — | 3000 |

Infrastructure: **PostgreSQL** (core-java's store), **RabbitMQ** (topic exchange
`ishtirak.events`), **Redis** (ephemeral real-time state / WebSocket fan-out).

## Polyglot rationale

The system is polyglot on purpose — each language is used where it is genuinely
strongest, not for novelty (see [ADR-001](#adr-001-polyglot-microservices)).

- **Java / Spring Boot for `core-java`** — the system of record needs
  transactional integrity (the billing run issues many invoices atomically),
  a mature ORM + migrations (JPA + Flyway), and battle-tested RBAC
  (Spring Security). This is Spring's home turf.
- **Python / FastAPI for `analytics-python`** — streaming anomaly detection and
  the eventual ML model live in Python's data ecosystem (NumPy, pandas,
  scikit-learn). FastAPI keeps the HTTP surface small and async-friendly for an
  event consumer.
- **Node / Express for `gateway-node`** — a BFF that aggregates REST calls and
  fans out WebSocket messages is I/O-bound; Node's event loop and first-class
  `ws` support make it the natural fit.
- **React for `web`** — the operator dashboard and subscriber portal are
  standard SPA territory.

## Cross-cutting concerns

- **Authentication boundary.** The gateway is the **only** service exposed to
  the browser. It verifies the end-user JWT on every request and on the WebSocket
  handshake, then forwards the authenticated identity inward. Inward propagation
  is concrete (ADR-008): internal services accept a gateway-signed **service**
  token (`gatewayServiceAuth`), **not** the raw browser JWT, and receive the
  end-user identity as the gateway-injected trusted headers `X-Operator-Id` +
  `X-Actor-Role`. The service token carries matching identity claims, giving
  internal services a signed value to compare before using the headers as the
  source every internal query filters by. Internal ports are `x-internal` (not
  browser-reachable). JWT secret is required and validated at boot (≥32 chars) —
  see `gateway-node/src/config.ts` and `infra/.env.example`.
  The full contract is encoded in the OpenAPI specs and [API.md](./API.md).
  ⏳ middleware lands in Phase 4.
- **Multi-tenant scoping.** Every entity, query, and event carries an
  `operatorId`. **Every** read/write in `core-java` is filtered by the caller's
  operator; every event includes `operatorId` so consumers stay tenant-scoped.
  This is a hard rule (see [CLAUDE.md](../CLAUDE.md)).
- **Configuration — fail fast at boundaries.** Each service validates its
  environment once at startup and crashes loudly if misconfigured: zod-parsed,
  frozen config in `gateway-node/src/config.ts`; an immutable `Settings`
  dataclass in `analytics-python/app/config.py`; Spring `application.yml` +
  env in `core-java`. No service starts in a half-configured state.
- **Input validation.** All external input (request bodies, event payloads, env
  vars) is validated at the boundary — Bean Validation in core-java, zod in the
  gateway, Pydantic in analytics. Event payloads are validated against the
  JSON Schemas in [`contracts/events`](../contracts/events).
- **Structured logging.** `pino`/`pino-http` (gateway), Uvicorn/Spring logging
  (analytics/core). Logs are structured for later aggregation.
- **Health & readiness.** Every service exposes `GET /health` (liveness) and
  `GET /ready` (readiness). core-java additionally exposes Spring Actuator
  probes. docker-compose health checks gate startup ordering. ✅
- **Observability.** Metrics/tracing hooks are ⏳ Phase 6.

## Directory map

```
ishtirak/
  services/
    core-java/          Spring Boot system of record (8081)
      src/main/java/dev/ishtirak/core/   app + feature packages
      src/test/java/...                  JUnit 5 tests
    analytics-python/   FastAPI analytics + ML (8082)
      app/              config, app factory, server entrypoint
      tests/            pytest suites
    gateway-node/       Express BFF + WebSocket (8080)
      src/              config, logger, app, server
  web/                  React + Vite frontend (3000)
  contracts/            shared API contracts (SOURCE OF TRUTH)
    events/             *.schema.json (JSON Schema draft 2020-12)
    openapi/            per-service REST specs (OpenAPI 3.1) + components.yaml
    asyncapi.yaml       events + WebSocket (AsyncAPI 3.1)
  infra/                docker-compose.yml, .env.example
  docs/                 this directory
  .github/workflows/    ci.yml (per-service build + test)
```

Conventions enforced repo-wide (from [CLAUDE.md](../CLAUDE.md)):

- **`contracts/` is the source of truth.** Changing anything there is a
  cross-service API change — update all consumers in the same PR.
- **Keep every file under 300 lines**; favor many small, cohesive files.
- **Use immutable objects** — never mutate in place; return new copies. Applies
  across Java, TypeScript, and Python.

---

## Architecture Decision Records

Short records of the load-bearing decisions. Format: **context · decision ·
consequences.**

### ADR-001: Polyglot microservices

**Context.** The product spans transactional billing, streaming ML, real-time
push, and a web UI — workloads with very different centers of gravity.
**Decision.** Split into four services, each in the language strongest for its
job (Java/Spring, Python/FastAPI, Node/Express, React), rather than a single
monolith. **Consequences.** Best-fit tooling per concern and independent
scaling/deploys; cost is operational overhead and the need for a shared
integration contract (see ADR-002) and per-service CI (`.github/workflows/ci.yml`).

### ADR-002: RabbitMQ topic exchange + shared event envelope

**Context.** Services must integrate asynchronously without coupling to each
other's internals. **Decision.** A single RabbitMQ topic exchange
`ishtirak.events` carries four domain events, all sharing one envelope
(`eventId`, `eventType`, `operatorId`, `occurredAt`, `payload`) defined as
JSON Schema in [`contracts/events`](../contracts/events). Routing keys equal the
event type. **Consequences.** Consumers bind only to the routing keys they need
and dedupe on `eventId`; the envelope's `operatorId` keeps every consumer
tenant-scoped. The contract is versioned and authoritative — schema changes
ripple to all consumers in one PR.

### ADR-003: Gateway BFF owns auth and WebSocket fan-out

**Context.** The browser needs one endpoint, authentication, response
aggregation, and real-time push. **Decision.** `gateway-node` is the sole
public surface: it verifies JWTs, aggregates/proxies REST to the internal
services, and owns the WebSocket server with Redis-backed fan-out. Internal
services are not exposed to the browser. **Consequences.** A single, hardened
trust boundary and a curated public API ([`API.md`](./API.md)); the gateway is a
critical path that must stay stateless (ephemeral state in Redis only —
ADR-006) so it can scale horizontally.

### ADR-004: core-java is the sole system of record

**Context.** Multiple services derive state from the same domain. **Decision.**
`core-java` (PostgreSQL, Flyway-managed schema) is the **only** authoritative
store for domain data; all domain mutations go through it and it is the sole
event publisher. Domain events are written through a transactional outbox in the
same PostgreSQL transaction as the domain change before they are published to
RabbitMQ. Other services hold only derived or ephemeral state.
**Consequences.** One source of truth and one writer of domain events; no
service reaches into another's database. Derived stores (analytics capture —
ADR-007; Redis — ADR-006) are reconstructable from core-java.

### ADR-005: Theft detection: rules first, ML later

**Context.** Tampering/theft detection is the signature feature, but there is no
production data to train on during development. **Decision.** Phase 3a ships
**explainable threshold/rule heuristics** (zero/negative deltas, sudden drops
vs. trailing average, consumption exceeding the tier's amperage cap). An
IsolationForest model (Phase 3b) comes later on the same feature vector; no
scikit-learn dependency is committed near-term. **Consequences.** A demoable,
explainable detector early; operators see *why* a reading was flagged. The ML
model is additive, not a blocker. See [SYSTEM_DESIGN](./SYSTEM_DESIGN.md) and
[ROADMAP](./ROADMAP.md).

### ADR-006: Redis for ephemeral real-time state only

**Context.** The real-time layer needs fast shared state for WebSocket fan-out
and live countdowns. **Decision.** Redis holds **only** ephemeral/real-time
state (WS subscriptions, outage countdown state, rolling reading state for the
rule engine). It is never a system of record. **Consequences.** Losing Redis
degrades real-time UX briefly but loses no durable data — everything is
re-derivable from core-java (ADR-004) and the event stream.

### ADR-007: Analytics capture store for post-deployment continuous learning

**Context.** The v1 detector cold-starts (ADR-005) — there is no real traffic to
learn from until the system is deployed. We want the *deployed* model to improve
over time on real-world data. **Decision.** `analytics-python` persists every
consumed event plus every **operator alert label** (confirmed / dismissed) to a
service-local **capture store**. After launch, a periodic **retraining loop**
trains and promotes new model versions from that data (an MLOps capability — see
[SYSTEM_DESIGN](./SYSTEM_DESIGN.md#continuous-learning-loop-post-deployment)).
The store is **SQLite (WAL mode)** now (single consumer, demo/dev) with a
documented **migration trigger** to a separate `analytics` schema in the shared
PostgreSQL (or a Parquet/object-store sink) when analytics scales horizontally.
**Consequences.** Zero new infra now and a self-contained analytics service; the
tradeoff is that SQLite is single-writer and makes analytics stateful (needs a
Docker volume), which conflicts with the stateless/scale-out goal — hence the
migration trigger. The capture store is the working copy, not durable truth:
RabbitMQ is not replayable after consumption, but core-java's PostgreSQL retains
the readings and can backfill it. **This is not a v1 input** — it only powers
post-launch retraining.

### ADR-008: Internal trust boundary & gateway identity propagation

**Context.** The gateway authenticates the browser (ADR-003), but the internal
services still need the end-user's operator + role to enforce tenant scoping and
RBAC — and they must not be bypassable by replaying a browser JWT directly to
their ports. **Decision.** Internal services (`core-java`, `analytics-python`)
expose a distinct security scheme `gatewayServiceAuth` and accept only a
short-lived, gateway-signed **service** token — never the raw browser JWT. The
gateway derives the end-user identity from the verified JWT and injects it inward
as the trusted headers `X-Operator-Id` (uuid) and `X-Actor-Role`
(`OPERATOR_ADMIN` | `OPERATOR_STAFF` | `SUBSCRIBER`), required on every internal
domain operation. The service token includes matching `operatorId`, `role`, and
optional `subscriberId` claims; a request missing or mismatching them is rejected.
Internal servers are marked `x-internal` (not routable from the browser).
**Consequences.** There is now a
defined source for the "filter every query by `operatorId`" hard rule, and the
browser-JWT-replay bypass is closed. The cost is that the gateway must mint/sign
service tokens and reliably inject the identity headers, and deployment must keep
internal ports off the public network. Encoded in
[`contracts/openapi/components.yaml`](../contracts/openapi/components.yaml)
(`gatewayServiceAuth`, `operatorIdHeader`, `actorRoleHeader`) and the per-service
specs; see also [API.md](./API.md) and the multi-tenancy section of
[SYSTEM_DESIGN](./SYSTEM_DESIGN.md#multi-tenancy).
