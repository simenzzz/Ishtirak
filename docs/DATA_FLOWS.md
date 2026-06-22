# Data Flows

> **Scope.** This document maps how data moves through the implemented Ishtirak
> codebase: browser state, gateway proxying, internal service trust, core
> transactions, outbox/event publishing, analytics consumers, derived stores, and
> WebSocket fan-out. For static structure see [`ARCHITECTURE.md`](./ARCHITECTURE.md);
> for field-level schemas see [`DATA_MODEL.md`](./DATA_MODEL.md); for REST and
> event contracts see [`API.md`](./API.md) and [`../contracts`](../contracts).
>
> **Source of truth.** Machine-readable contracts remain in `contracts/`. This
> file is the human implementation map for the current tree, including the
> invoice review/status-change flow.

## System Map

```
web (React)
  | REST /api + WS /api/ws
  v
gateway-node
  | service-token REST                  | RabbitMQ events -> Redis pub/sub -> WS
  v                                     v
core-java <------ service-token ------ analytics-python
  | PostgreSQL + outbox                 | SQLite capture + Redis rolling state
  v                                     v
RabbitMQ topic exchange `ishtirak.events`
```

| Boundary | Data Entering | Validation / Trust | Output |
| --- | --- | --- | --- |
| Browser -> gateway | JSON REST, bearer access token, refresh cookie, WS subprotocol | React form checks, gateway JWT verification, zod schemas, rate limits | Proxied REST, WS subscriptions |
| Gateway -> core | Service token + `X-Operator-Id` / role headers | Core service-token/header match, `RequestIdentity`, Bean Validation | PostgreSQL mutations/queries, outbox events |
| Gateway -> analytics | Service token + operator role headers | Analytics service-token/header match, operator-only roles | Risk and collection-rate JSON |
| Core -> RabbitMQ | Outbox envelope + payload | JSON Schema validation before publish | Domain events |
| RabbitMQ -> analytics | `reading.recorded`, `invoice.issued`, `payment.received` | Pydantic event models, idempotency via `captured_events.event_id` | SQLite/Redis derived state, `reading.flagged` |
| RabbitMQ -> gateway | `outage.scheduled`, `invoice.issued`, `invoice.status.changed`, `reading.flagged` | zod event parsing | Redis fanout envelope, WS message |

Cross-cutting rules:

- `operatorId` is the tenant key on rows, events, service tokens, Redis keys, and
  analytics queries.
- The browser never supplies tenant scope directly; the gateway derives it from
  a verified access JWT.
- Core is the system of record. Analytics SQLite/Redis and gateway Redis are
  derived or ephemeral.
- RabbitMQ is at-least-once; analytics dedupes on `eventId`, gateway retries
  fanout once, and poison messages dead-letter.

## Auth And Session Flow

```
LoginPage/AuthProvider
  -> POST /api/auth/login
  -> gateway public auth route
  -> core /auth/login
  -> core verifies password + memberships
  <- accessToken + refreshToken or selectionToken
  -> gateway moves refreshToken to HttpOnly `ishtirak.refresh`
  -> web keeps accessToken in memory only
  -> GET /api/me sets React identity
```

| Step | Implementation | Data Logic |
| --- | --- | --- |
| Login | `web/src/auth/AuthContext.tsx`, `gateway-node/src/proxy/authRoutes.ts`, `core-java/.../AuthService.java` | Core returns a context-bound access JWT for one membership, or a short-lived selection token for multi-membership users. |
| Context selection | `ContextSelectPage`, `/auth/select-context` | Selection token + membership id becomes an access/refresh pair for one operator context. |
| Refresh | `apiClient.refreshSession`, gateway `/auth/refresh`, core `/auth/refresh` | Browser sends only the HttpOnly cookie; gateway injects cookie value into the core request body; core rotates single-use refresh tokens and revokes the family on reuse. |
| Logout | gateway `makeLogoutHandler`, core `/auth/logout` | Gateway clears the cookie even if best-effort core family revocation fails. |
| Internal trust | `mintServiceToken`, `InternalIdentityInterceptor`, analytics verifier | Gateway signs short-lived service tokens; internal services compare token claims with trusted headers before using identity. |

## REST Proxy Flow

```
apiRequest(path)
  -> /api/*
  -> authMiddleware verifies access token
  -> fixedWindowRateLimit
  -> role middleware
  -> zod params/query/body
  -> mint service token
  -> fetch(core-java or analytics-python)
  -> pass JSON/status back to browser
```

Gateway route families:

| Public Route Family | Upstream | Main Data Outcome |
| --- | --- | --- |
| `/api/subscribers`, `/api/tiers` | core | Tenant-scoped ledger and tariff CRUD in PostgreSQL. |
| `/api/readings`, `/api/me/readings` | core | Reading writes emit `reading.recorded`; reads return operator/subscriber history. |
| `/api/billing-runs`, `/api/invoices`, `/api/payments` | core | Billing, invoice review, and payment workflows. |
| `/api/outages` | core | Outage schedule/list; schedule emits `outage.scheduled`. |
| `/api/analytics/*` | analytics | Derived collection-rate and risk data from SQLite capture store. |
| `/api/me` | gateway | Echoes verified identity without upstream call. |

`apiRequest` retries once on authenticated `401` by refreshing the access token
from the cookie. If refresh fails, it clears memory state and dispatches a
session-expired event.

## Core Domain Flows

### Subscriber And Tier Management

```
Operator form -> gateway -> core controller -> service -> JPA repository -> PostgreSQL
```

- Subscriber create/update checks role (`admin` for writes), validates the
  target tier under the same operator, and stores immutable domain copies via
  `SubscriberEntity`.
- Tier create/update validates pricing and patch fields, computes effective
  policy from operator default plus optional tier override, and stores via
  `TierEntity`.
- These flows do not emit events; downstream services learn tier data only by
  synchronous lookup from analytics when needed for tier-cap scoring.

### Reading Ingestion And Tampering Detection

```
RecordReadingForm
  -> POST /api/readings
  -> core ReadingService
      - ensure subscriber belongs to operator
      - reject duplicate timestamp
      - staff cannot backdate or roll back; admin can
      - save Reading
      - enqueue reading.recorded
  -> OutboxPublisher -> RabbitMQ
  -> analytics ReadingPipeline
      - capture event once
      - load Redis rolling state and cached tier
      - on tier miss, call core /subscribers/{id} then /tiers/{id}
      - extract features, apply rules
      - save next rolling state
      - persist RiskFlag and best-effort publish reading.flagged
  -> gateway consumes reading.flagged
  -> WS tampering.alert to operator alert subscribers
```

Reading risk rules fire in priority order: negative delta, zero delta, exceeds
tier cap, then drop greater than configured threshold. Cold-start readings update
state but do not have enough history for delta-based rules.

### Billing, Invoice Review, And Subscriber Bill Updates

```
BillingRunPage
  -> POST /api/billing-runs with Idempotency-Key
  -> core BillingService.runBilling
      - validate period
      - lock operator
      - reuse prior BillingRunEntity on same idempotency key + period
      - for each active subscriber:
          compute consumption = readingBefore(end+1) - readingBefore(start+1)
          if missing/negative: create NEEDS_REVIEW invoice, amount 0
          else calculate tariff and create ISSUED invoice
      - save BillingRunEntity with invoice ids
      - enqueue invoice.issued or invoice.status.changed per invoice
  -> gateway invoice events -> WS invoice.ready / invoice.updated
  -> subscriber CurrentBillPage refetches /me/invoices
```

Invoice resolution:

| Action | Preconditions | Core Change | Event |
| --- | --- | --- | --- |
| Reissue | Admin, invoice is `NEEDS_REVIEW`, consumption is now computable | Recalculate amounts/kWh, set `ISSUED` | `invoice.issued` |
| Void | Admin, invoice is `NEEDS_REVIEW` or unpaid `ISSUED` | Set `VOID` | `invoice.status.changed` |
| Pay | Staff/admin, invoice is not `NEEDS_REVIEW` or `VOID` | Save payment, set `PARTIAL` or `PAID` | `payment.received` |

`CurrentBillPage` renders `NEEDS_REVIEW` and `VOID` as status headlines instead
of `$0`, and refetches on both `invoice.ready` and `invoice.updated`.

### Payments And Collection Rate

```
RecordPaymentForm
  -> POST /api/payments
  -> core PaymentService
      - lock invoice by operator
      - reject non-payable status
      - compute outstanding paid totals
      - apply USD/LBP tender using invoice ratio where needed
      - cap applied amount to outstanding balance
      - save Payment, update invoice status
      - enqueue payment.received
  -> analytics BillingPipeline
      - record event once
      - add applied amounts to invoice_ledger
  -> AnalyticsPage -> GET /api/analytics/collection-rate
```

Payments can arrive at analytics before the matching `invoice.issued`; the
SQLite ledger inserts a placeholder row and the later invoice event fills period
and issued amounts without losing paid totals.

### Outage Countdown

```
OutagesPage
  -> POST /api/outages
  -> core OutageService validates endsAt > startsAt
  -> save Outage + enqueue outage.scheduled
  -> gateway maps event to outage.countdown
  -> Redis pub/sub fanout
  -> subscriber WS clients on `outages` channel
  -> OutageCountdown updates live seed
```

Outage reads are REST snapshots from core. Live WS messages carry countdown
deltas; reconnecting clients fetch snapshots again and then resume live updates.

## Analytics Query And Labeling Flows

| API | Source Store | Data Logic |
| --- | --- | --- |
| `GET /analytics/risk` | `risk_flags` + `alert_labels` | Filter by `operatorId`, optional subscriber/min score, paginate newest flags first. |
| `GET /analytics/risk/{readingId}` | `risk_flags` | Return one operator-scoped flag or 404. |
| `POST /analytics/risk/{readingId}/label` | `alert_labels` | Confirm/dismiss a risk flag for future training labels. |
| `GET /analytics/collection-rate` | `invoice_ledger` | Group issued invoices by period, sum issued/paid USD/LBP, compute USD collection rate. |

All analytics REST endpoints require a gateway service token with an
operator-staff/admin role. Subscriber roles are rejected.

## WebSocket Fanout Flow

```
Browser useWebSocket(role)
  -> connect /api/ws with subprotocols: ishtirak.v1, bearer.<accessToken>
  -> gateway verifies access token
  -> client sends subscribe { channels }
  -> gateway filters channels by role
  -> RabbitMQ event -> gateway parser -> Redis `ws:fanout`
  -> every gateway instance fans out to matching sockets
```

| Channel | Allowed Roles | Event Source | WS Message |
| --- | --- | --- | --- |
| `alerts` | `OPERATOR_ADMIN`, `OPERATOR_STAFF` | `reading.flagged` | `tampering.alert` |
| `invoices` | `SUBSCRIBER` with matching `subscriberId` | `invoice.issued`, `invoice.status.changed` | `invoice.ready`, `invoice.updated` |
| `outages` | `SUBSCRIBER` | `outage.scheduled` | `outage.countdown` |

The gateway registry is immutable-copy state in memory; Redis pub/sub lets
events consumed by one gateway instance reach sockets held by any instance.

## Store And Idempotency Matrix

| Store | Owner | Data | Idempotency / Failure Behavior |
| --- | --- | --- | --- |
| PostgreSQL | core | Operators, users, memberships, subscribers, tiers, readings, invoices, payments, outages, billing runs, outbox | DB constraints, row locks, optimistic invoice version, billing idempotency key, transactional outbox. |
| RabbitMQ | infra | `ishtirak.events` topic exchange and durable queues | At-least-once delivery; routing key equals `eventType`; DLQs for poison or repeated transient failures. |
| SQLite capture | analytics | `captured_events`, `risk_flags`, `alert_labels`, `invoice_ledger` | `captured_events.event_id` is the dedupe gate; ledger updates commit atomically with event capture. |
| Redis analytics | analytics | `analytics:state:{op}:{sub}`, `analytics:tier:{op}:{sub}` | Reconstructable rolling/cache state; tier cache has TTL. |
| Redis gateway | gateway | Rate-limit keys, `ws:fanout` pub/sub | Rate limiter fails open on Redis errors; fanout publish failure requeues once then DLQs. |
| Browser memory/cookie | web/gateway | Access token in JS memory, refresh token in HttpOnly cookie | Hard reload rehydrates via refresh cookie; terminal refresh failure clears session. |

## Failure Paths

- Boundary validation failure returns `400` with a normalized error envelope
  where the gateway/core owns the boundary.
- Missing/invalid browser JWT returns `401`; wrong role returns `403`.
- Internal service-token/header mismatch returns `401` in core and `403` in
  analytics for header mismatch.
- Gateway upstream fetch failure returns `502 BAD_GATEWAY`.
- Core outbox publish failure marks the row failed and schedules retry after
  backoff; committed domain state is retained.
- Analytics poison events dead-letter immediately; transient failures requeue
  once and then dead-letter on redelivery.
- `reading.flagged` publish failure does not fail the consumed reading event:
  the risk flag is already persisted, but the live push is skipped.
- WebSocket messages are deltas, not durable delivery. REST snapshots are the
  recovery path after reconnect.
