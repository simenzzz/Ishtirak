# Ishtirak

A multi-tenant platform for Lebanon's neighborhood diesel-generator operators
("ishtirak" / اشتراك). Operators manage subscribers, amperage tiers, meter
readings, billing, and load-shedding schedules; subscribers get a portal with
their bill, consumption, and live outage alerts. A streaming analytics service
flags meter tampering / electricity theft.

Built as a **polyglot microservices** system — each language does what it is
genuinely good at.

## Stack

| Service | Role | Technology |
|---------|------|------------|
| `services/core-java` | System of record (subscribers, tiers, billing, payments, RBAC) | Java 21, Spring Boot 3, Spring Data JPA, Spring Security, Flyway, PostgreSQL |
| `services/gateway-node` | API gateway / BFF + real-time | Node 20, Express 5, TypeScript, ws, RabbitMQ |
| `services/analytics-python` | Streaming theft detection + operator analytics | Python 3.12, FastAPI, Pydantic v2, scikit-learn |
| `web` | Operator dashboard + subscriber portal | React 19, Vite, TypeScript |
| Infra | Async events + ephemeral state | RabbitMQ (topic exchange), Redis |

## Architecture

```
                React + TS frontend
        (operator dashboard  +  subscriber portal)
                          │
              ┌───────────▼────────────┐
              │  Gateway / BFF (Node)   │  auth, aggregation, WebSocket
              └───┬─────────────────┬───┘
                  │ REST            │ REST
        ┌─────────▼─────────┐  ┌────▼──────────────────┐
        │ core-java         │  │ analytics-python      │
        │ (system of record)│  │ (theft detection)     │
        └─────────┬─────────┘  └────────┬──────────────┘
                  │                      │
              PostgreSQL          consumes events
                  │                      │
                  └──── RabbitMQ (topic) ────┘   +  Redis (real-time)
```

Domain events (topic exchange `ishtirak.events`): `reading.recorded`,
`invoice.issued`, `payment.received`, `outage.scheduled`. Schemas live in
[`contracts/events`](contracts/events) and are the source of truth shared by all
services.

## Quick start

```bash
cd infra
docker compose up --build
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| Gateway API | http://localhost:8080 |
| core-java | http://localhost:8081 |
| analytics-python | http://localhost:8082 |
| RabbitMQ management | http://localhost:15672 (guest/guest) |

Every service exposes `/health` and `/ready`.

## Demo runbook

See [`docs/DEMO.md`](docs/DEMO.md) for the three showcase flows (billing run,
tampering catch, load-shedding countdown).
