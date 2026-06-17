# Ishtirak

Ishtirak is a multi-tenant platform for Lebanon's neighborhood diesel-generator
operators. Each operator (the tenant) manages subscribers on amperage tiers, records
meter readings, runs monthly billing, records payments, and schedules load-shedding
outages. A streaming analytics service flags meter tampering / theft from the reading
stream, and a real-time layer pushes outage countdowns and alerts to subscribers.

It is built as a polyglot microservices system — each language is used where it is
genuinely strongest:

| Service             | Stack                         | Role                                            |
| ------------------- | ----------------------------- | ----------------------------------------------- |
| `core-java`         | Java 21, Spring Boot 3.2      | System of record: subscribers, tiers, readings, billing, payments, RBAC. Emits domain events. |
| `analytics-python`  | Python 3.12, FastAPI          | Consumes `reading.recorded`, scores tampering/theft, serves operator analytics. |
| `gateway-node`      | Node 20, Express 5 + TS       | BFF / API gateway, JWT verification, aggregation, WebSocket real-time pushes. |
| `web`               | React 19, Vite, TS            | Operator dashboard + subscriber portal.         |

Async backbone: **RabbitMQ** topic exchange `ishtirak.events` (events:
`reading.recorded`, `invoice.issued`, `payment.received`, `outage.scheduled`).
**Redis** for ephemeral real-time state / WebSocket fan-out. **PostgreSQL** is
core-java's store. The `contracts/` directory is the source of truth for the shared
event envelope and per-service OpenAPI.

## Directory Structure

```
ishtirak/
  services/
    core-java/          Spring Boot system of record (port 8081)
      src/main/java/dev/ishtirak/core/   app + feature packages
      src/test/java/...                  JUnit 5 tests
    analytics-python/   FastAPI analytics + ML (port 8082)
      app/              config, app factory, server entrypoint
      tests/            pytest suites
    gateway-node/       Express BFF + WebSocket (port 8080)
      src/              config, logger, app, server
  web/                  React + Vite frontend (port 3000)
    src/                components, pages, test setup
  contracts/            shared event schemas + OpenAPI (source of truth)
    events/             *.schema.json (JSON Schema draft 2020-12)
  infra/                docker-compose.yml, .env.example
  docs/                 DEMO.md runbook, architecture notes
  .github/workflows/    ci.yml (per-service build + test)
```

## Working Rules

These are hard rules for any work in this repo.

### Reviews (mandatory)
- After **any code change that touches logic**, run the
  `everything-claude-code:code-reviewer` sub agent on the changes before declaring
  the work complete. Running tests and a type checker is not a substitute.
- For **any API change or security-critical change** (auth, RBAC, multi-tenant
  isolation, payments, user input, event/websocket protocol surface), additionally
  run the `everything-claude-code:security-reviewer` sub agent.
- When both apply, run the reviewers in parallel (one message, multiple agent calls).
- Address every CRITICAL and HIGH finding before reporting work as done.
- Trivial changes (typos, comments, one-line fixes) may skip the review pass.

### Code
- **Keep every file under 300 lines.** Split by feature/responsibility when a file
  approaches the limit; favor many small, cohesive files over few large ones.
- **Use immutable objects.** Never mutate existing objects in place — return new
  copies with the change. This applies across Java, TypeScript, and Python.
- Validate all external input at system boundaries (request bodies, event payloads,
  env vars). Enforce multi-tenant scoping (every query filtered by operator).

### Collaboration
- **When unsure, always ask the user.** Do not guess on ambiguous requirements,
  scope, or design trade-offs — surface the question instead of assuming.

## Build & Test

| Service            | Install / Build              | Test                          |
| ------------------ | ---------------------------- | ----------------------------- |
| `core-java`        | `mvn -B verify`              | `mvn test`                    |
| `analytics-python` | `pip install -e .[dev]`      | `pytest --cov`                |
| `gateway-node`     | `npm install`                | `npm test` (vitest)           |
| `web`              | `npm install`                | `npm test` (vitest + RTL)     |

Full stack: `docker compose -f infra/docker-compose.yml up --build`. Each service
exposes `/health` and `/ready`. Target 80%+ test coverage per service.

> Note: in the offline sandbox, core-java resolves only against the local `~/.m2`
> cache (Spring Boot 3.2.0 is fully cached); use `mvn -o` for offline builds.
