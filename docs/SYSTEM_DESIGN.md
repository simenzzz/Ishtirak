# System Design

> **Scope.** This document describes Ishtirak's **runtime behaviour** — the
> domain model, how requests and events flow, the theft-detection pipeline, the
> continuous-learning loop, the real-time layer, multi-tenancy, and scaling /
> failure modes. For **static structure** (services, tech choices, ADRs) see
> [`ARCHITECTURE.md`](./ARCHITECTURE.md). For the **API surface** see
> [`API.md`](./API.md). For the **build-out plan** see [`ROADMAP.md`](./ROADMAP.md).
>
> Most behaviour below is ⏳ **planned** (Phases 2–6). The event envelope and the
> four event payloads are ✅ **defined** in
> [`contracts/events`](../contracts/events) and anchor this design.

## Domain model

`core-java` is the system of record (ADR-004). The core entities, all scoped to
an **operator** (tenant):

```
Operator (tenant)
  └─ User ───────── role ∈ {OPERATOR_ADMIN, OPERATOR_STAFF, SUBSCRIBER}
  └─ Tier ───────── amperage (e.g. 5A/10A/15A), standing fee, per-kWh rate
  └─ Subscriber ─── belongs to one Tier
        └─ Reading ──── cumulative kWh @ readingAt
        └─ Invoice ──── period, kwhConsumed, amountUsd, status
              └─ Payment ── amountUsd, method ∈ {CASH, WHISH}
  └─ Outage ─────── startsAt, endsAt, reason ∈ {FUEL, MAINTENANCE, GRID, OTHER}
```

```
Operator 1───* Subscriber 1───* Reading
Operator 1───* Tier      1───* Subscriber
Subscriber 1───* Invoice 1───* Payment
Operator 1───* Outage
```

### Billing model (assumption — confirm at Phase 2)

> ⚠️ The event contracts fix the **invoice shape** (`kwhConsumed`, `amountUsd`,
> `periodStart`, `periodEnd` — see
> [`invoice-issued.schema.json`](../contracts/events/invoice-issued.schema.json))
> but not the **pricing formula**. The design assumes:
>
> ```
> kwhConsumed = reading(periodEnd) − reading(periodStart)   # cumulative meter delta
> amountUsd   = tier.standingFee + kwhConsumed × tier.perKwhRate
> ```
>
> Confirm the exact tariff (flat tier fee vs. metered vs. hybrid; rounding;
> currency handling) with the product owner before implementing the billing run.

## Sequence flows (the three showcase scenarios)

These are the v1 vertical slices targeted by [`docs/DEMO.md`](./DEMO.md).

### 1. Billing run

```
Operator ──POST /api/billing-runs──► gateway ──► core-java
                                                   │ in ONE transaction:
                                                   │  • compute kwhConsumed per subscriber
                                                   │  • create Invoice rows
                                                   │  • commit
                                                   └─ emit invoice.issued  (one per invoice)
                                                          │
                              ┌───────────────────────────┴───────────────┐
                              ▼                                            ▼
                        gateway-node                                analytics-python
                   consumes invoice.issued                     consumes invoice.issued
                   WS push "your bill is ready"                 recompute collection-rate
                   to each subscriber                           summary
```

The billing run is **atomic**: either all invoices for the period are issued or
none are (see [Failure modes](#scaling--failure-modes)). Events are emitted only
after commit.

### 2. Tampering catch

```
Operator ──POST /api/readings──► gateway ──► core-java
                                              │ persist Reading
                                              └─ emit reading.recorded
                                                     │
                                                     ▼
                                            analytics-python
                                              • load per-subscriber rolling state (Redis)
                                              • compute features, run rule engine
                                              • append event to capture store (ADR-007)
                                              • if risk flagged → expose via risk API
                                                + emit/forward alert
                                                     │
                                                     ▼
                                              gateway-node ── WS "tampering alert" ──► operator
```

### 3. Load-shedding countdown

```
Operator ──POST /api/outages──► gateway ──► core-java
                                             │ persist Outage
                                             └─ emit outage.scheduled
                                                    │
                                                    ▼
                                             gateway-node
                                               • store countdown state in Redis
                                               • WS stream live countdown ticks
                                                 to every affected subscriber
```

## Event-driven design

All asynchronous integration goes through the RabbitMQ topic exchange
`ishtirak.events` (ADR-002). Every event shares the envelope defined in
[`contracts/README.md`](../contracts/README.md):

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `eventId` | uuid | unique per emission — **idempotency key** for consumers |
| `eventType` | string | equals the routing key, e.g. `reading.recorded` |
| `operatorId` | uuid | tenant scope — keeps consumers tenant-isolated |
| `occurredAt` | date-time (UTC) | when the domain fact happened |
| `payload` | object | event-specific (per-event schema) |

- **Routing.** Routing key = `eventType`. Consumers bind a queue to only the
  keys they need (e.g. analytics binds `analytics.reading-recorded` to
  `reading.recorded` — see `analytics-python/app/config.py`).
- **Delivery semantics.** At-least-once. Consumers must be **idempotent**,
  deduping on `eventId` (a processed-id set / unique constraint). Re-delivery on
  redeploy or nack is expected and safe.
- **Ordering.** No global ordering guarantee. Where order matters (cumulative
  meter readings), consumers order by `occurredAt` / `readingAt` and tolerate
  out-of-order arrival rather than assuming broker order.
- **Producer.** Only `core-java` publishes (ADR-004), and only **after** the
  owning DB transaction commits, to avoid emitting events for rolled-back state.
- **Validation.** Producers and consumers validate payloads against the
  [`contracts/events`](../contracts/events) JSON Schemas.

## Theft-detection pipeline (rules-first)

Phase 3a is an **explainable rule engine** over the `reading.recorded` stream
(ADR-005). For each reading:

1. **Derive features** from the new reading and per-subscriber rolling state
   (held in Redis):
   - `delta = kwh − previousKwh` (cumulative meter movement).
   - `dropPct` of `delta` vs. the subscriber's trailing average consumption.
   - `delta` vs. the **tier amperage cap** (a 5A subscriber cannot physically
     pull 15A-tier consumption).
   - zero / negative `delta` (meter stalled or rolled back).
2. **Apply rules** → a risk flag with a **reason code** (e.g. `NEGATIVE_DELTA`,
   `DROP_GT_THRESHOLD`, `EXCEEDS_TIER_CAP`). Thresholds are configuration, not
   hardcoded.
3. **Output**: persist/serve the risk score per reading (queryable via the
   analytics risk API) and surface an operator alert through the gateway's
   WebSocket.

Because the output carries an explicit reason, operators see *why* a reading was
flagged — and their confirm/dismiss feedback becomes a training label (below).

**Phase 3b (later):** an `IsolationForest` (scikit-learn) scores the same feature
vector for anomalies the static rules miss, complementing — not replacing — the
rules.

## Continuous-learning loop (post-deployment)

> The v1 model **cold-starts** — there is no production data during development.
> This loop improves the **deployed** model over time; it is **not** a v1 input
> (ADR-007).

```
ONLINE (per reading)                      OFFLINE (periodic, post-launch)
─────────────────────                     ──────────────────────────────────
reading.recorded                          capture store ──► retraining job
   │                                          (events +        │ train candidate
   ▼                                           labels)         │ evaluate vs live
analytics: score (rules/ML)                                    │  (precision/recall)
   │ append event + features                                   │ promote if better
   ▼                                                            ▼
capture store (SQLite/WAL)  ◄── operator confirm/dismiss   model registry (versioned)
                                 = training LABEL                │ drift / quality monitor
```

- **What is captured:** every consumed event (immutable, `operatorId`-scoped)
  **and** every operator alert outcome (confirmed = true positive, dismissed =
  false positive). Labels are what make retraining valuable.
- **Store:** SQLite in WAL mode now (single consumer, demo/dev), behind a
  repository interface so the backing store can change without touching callers.
  **Migration trigger:** when analytics scales to multiple consumer instances
  (SQLite is single-writer), move capture to a separate `analytics` schema in
  the shared PostgreSQL, or a Parquet/object-store sink for batch training.
- **Durability:** the capture store is the working copy, not the source of
  truth. RabbitMQ is not replayable post-consume, but core-java's PostgreSQL
  retains the readings, so the capture store is **backfillable** if lost.
- **Retraining loop:** a scheduled job reads accumulated traffic + labels,
  trains a candidate model, evaluates it against the live model, and promotes it
  via model versioning; drift/quality is monitored. This is the **post-v1 /
  operational track** in [ROADMAP](./ROADMAP.md), distinct from v1 model quality.

## Real-time layer

`gateway-node` owns the WebSocket server (ADR-003), with Redis for fan-out state
(ADR-006).

- **Handshake & auth.** The client connects with its JWT; the gateway verifies
  it on upgrade and binds the socket to `(operatorId, subscriberId, role)`.
  Unauthenticated upgrades are rejected.
- **Channels / message types:**
  - subscriber ← **outage countdown** ticks (from `outage.scheduled` + a timer).
  - subscriber ← **bill ready** (from `invoice.issued`).
  - operator ← **tampering alert** (from the analytics risk signal).
- **Fan-out.** Redis tracks which sockets belong to which operator/subscriber so
  a single event reaches all relevant connections, including across multiple
  gateway instances (Redis pub/sub).
- **Reconnect / backfill.** On reconnect the client re-authenticates and pulls
  current state (active outage, latest bill) via REST, then resumes the live
  stream — the WebSocket carries deltas, REST carries the snapshot.

## Multi-tenancy

Tenant isolation is enforced at **every** layer, not just the UI:

- Every domain row carries `operatorId`; every core-java query is filtered by
  the authenticated operator (no cross-operator reads/writes).
- Every event carries `operatorId`; consumers key all derived state and all
  WebSocket fan-out by it.
- The gateway derives `operatorId` from the verified JWT, never from
  client-supplied parameters.
- The analytics capture store and Redis state are partitioned by `operatorId`.

A bug that leaks data across operators is a **critical** defect — these paths get
a mandatory `security-reviewer` pass per [CLAUDE.md](../CLAUDE.md).

## Scaling & failure modes

- **Stateless services scale horizontally.** `gateway-node` and
  `analytics-python`'s HTTP layer hold no durable state (Redis/SQLite aside), so
  they scale out behind a load balancer. The one caveat is the analytics
  **capture store** (SQLite is single-writer — see the migration trigger above).
- **Billing-run integrity.** Invoices for a period are issued in a single DB
  transaction; a failure rolls back the whole run and emits no events. Re-running
  is idempotent (guard against duplicate invoices per subscriber+period).
- **Broker durability & retries.** The exchange and consumer queues are durable;
  messages are persistent and acked only after successful processing. Repeated
  failures route to a **dead-letter queue** for inspection rather than infinite
  redelivery. ⏳ DLQ/retry hardening is Phase 6.
- **Idempotent consumers.** Dedup on `eventId` makes at-least-once delivery and
  redelivery-on-redeploy safe.
- **Partial-outage degradation.** If `analytics-python` is down, readings still
  persist in core-java and events queue up — detection catches up on recovery.
  If Redis is down, real-time UX degrades but no durable data is lost (ADR-006).
  If the gateway is down, the browser loses access but the system of record is
  unaffected.
- **Config fail-fast.** A misconfigured container crashes at boot (validated
  config), never serving requests in a broken state.
