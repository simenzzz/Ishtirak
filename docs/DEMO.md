# Demo runbook

> **Status:** Phase 5 UI is wired. The operator dashboard and subscriber portal
> talk only to the gateway BFF at `http://localhost:8080`; Playwright E2E
> automation is deferred to Phase 6.

## Bring up the stack

```bash
cd infra
cp .env.example .env   # generate JWT/service secrets before running
CORE_JAVA_PROFILES=dev DEMO_PASSWORD='replace-with-12-plus-chars' docker compose up --build
```

The dev seed profile creates demo users:

- `admin@ishtirak.local`
- `staff@ishtirak.local`
- `subscriber@ishtirak.local`

Use the same `DEMO_PASSWORD` for all three. The password must be at least 12
characters.

Smoke-test every service:

```bash
docker compose exec gateway-node node -e "fetch('http://core-java:8081/health').then(r=>{if(!r.ok)process.exit(1);console.log(r.status)}).catch(()=>process.exit(1))"
curl localhost:8082/health   # analytics-python
curl localhost:8080/health   # gateway-node
curl localhost:3000          # web
```

Run the core-java Docker-backed smoke test:

```bash
cd ../services/core-java
./mvnw -Dtest=Phase2ContainersTest test
# If Docker Java negotiates the wrong API version:
./mvnw -Ddocker.api.version=1.52 -Dtest=Phase2ContainersTest test
```

## Auth & session model

The browser never holds the refresh token: on login/select-context the gateway
moves it into an HttpOnly `ishtirak.refresh` cookie (stripped from the JSON body)
and the web keeps only the short-lived access token in memory. A page reload
re-mints the access token from the cookie via `POST /api/auth/refresh`; **Sign
out** calls `POST /api/auth/logout` to clear it. The gateway allows credentialed
requests only from `WEB_ORIGIN` (default `http://localhost:3000`) via CORS, and
sets the cookie `Secure` by default (`COOKIE_SECURE`; browsers honour Secure on
`localhost`). Set `COOKIE_SECURE=false` only for a non-localhost plain-HTTP setup.

## Showcase flows

### 1. Billing run

1. Open `http://localhost:3000/login`.
2. Sign in as `admin@ishtirak.local`.
3. Go to **Billing**, choose the period, and run billing.
4. Open **Analytics** and confirm the collection-rate cards refresh from the
   gateway analytics endpoint.
5. In a second browser session, sign in as `subscriber@ishtirak.local` and keep
   **Bill** open. The `invoice.ready` WebSocket push triggers a REST refresh so
   the latest bill appears with USD and LBP totals.

### 2. Tampering catch

1. Stay signed in as `admin@ishtirak.local` or `staff@ishtirak.local`.
2. Go to **Readings** or open a subscriber and record an anomalous meter value.
3. `analytics-python` scores the `reading.recorded` event.
4. Keep **Analytics** open and confirm the live tampering alert appears in the
   alert strip with reason and score.

### 3. Load-shedding countdown

1. Sign in as `admin@ishtirak.local`.
2. Go to **Outages** and schedule an outage.
3. In a second browser session signed in as `subscriber@ishtirak.local`, open
   **Outage**.
4. The `outage.countdown` WebSocket push seeds the portal countdown, and the
   browser ticks the remaining time locally.

## Phase 1 status (done)

- Repo layout, event contracts (`contracts/`), docker-compose (`infra/`).
- Bootable skeletons for all four services, each answering `/health` + `/ready`.
- Per-service test suites green; CI runs all four.
