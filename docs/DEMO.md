# Demo runbook

> **Status:** Phase 1 (scaffolding). The three showcase flows below are the
> target for the v1 vertical slice — they are **not wired yet**. This file is the
> script we build toward in Phases 2–6.

## Bring up the stack

```bash
cd infra
cp .env.example .env   # adjust JWT_SECRET for anything non-local
docker compose up --build
```

Smoke-test every service:

```bash
curl localhost:8081/health   # core-java
curl localhost:8082/health   # analytics-python
curl localhost:8080/health   # gateway-node
curl localhost:3000          # web
```

## Showcase flows (target — Phases 2–6)

### 1. Billing run
Operator triggers the monthly billing run → `core-java` issues invoices in one
transaction and emits `invoice.issued` → `gateway-node` pushes "your bill is
ready" over WebSocket → `analytics-python` recomputes the collection-rate summary.

### 2. Tampering catch
Operator records a meter reading → `core-java` emits `reading.recorded` →
`analytics-python` scores it for tampering → an anomalous reading raises a risk
flag → `gateway-node` alerts the operator in real time.

### 3. Load-shedding countdown
Operator schedules an outage → `core-java` emits `outage.scheduled` →
`gateway-node` streams a live countdown to every affected subscriber.

## Phase 1 status (done)

- Repo layout, event contracts (`contracts/`), docker-compose (`infra/`).
- Bootable skeletons for all four services, each answering `/health` + `/ready`.
- Per-service test suites green; CI runs all four.
