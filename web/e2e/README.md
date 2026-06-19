# End-to-end tests (Playwright)

These specs exercise the three [`docs/DEMO.md`](../../docs/DEMO.md) showcase flows
against the **full docker-compose stack** — web + gateway + core-java + analytics +
Postgres/Redis/RabbitMQ — seeded with the `dev` profile demo users. They are *not*
mocked: they drive the real UI, real gateway, and real WebSocket fan-out.

Because they need the whole stack and browser binaries, they are **not** part of the
Vitest unit run (`npm test`) and do not run in the per-service CI jobs.

## One command (recommended)

```bash
infra/run-e2e.sh            # build + start the stack, wait for readiness, run the suite
infra/run-e2e.sh --down     # ...and tear the stack down when finished
```

`run-e2e.sh` writes a self-contained `infra/.env.e2e` (generated secrets,
`CORE_JAVA_PROFILES=dev`, `DEMO_PASSWORD`) — it never touches your real `infra/.env` —
brings the stack up, blocks on [`infra/wait-for-login.sh`](../../infra/wait-for-login.sh)
until a real login through the gateway succeeds (not just `/ready`, which doesn't prove
core-java is seeded), installs Playwright, and runs the suite. Requires Docker and
network access (image builds + the Playwright browser download). On WSL2,
`--with-deps` installs apt system libs via `sudo`; headless Chromium then runs without a
display. Override `DEMO_PASSWORD` by exporting it before the run.

## Manual steps (if you prefer)

```bash
cd infra
cp .env.example .env                 # fill *_SECRET values (>=32 chars), set
                                     # CORE_JAVA_PROFILES=dev and DEMO_PASSWORD (>=12 chars)
docker compose up -d --build
DEMO_PASSWORD='ishtirak-demo-password' ./wait-for-login.sh   # waits for true readiness
cd ../web
npm install
npx playwright install --with-deps chromium
DEMO_PASSWORD='ishtirak-demo-password' npm run test:e2e
```

`DEMO_PASSWORD` must match the value passed to the stack (the helper falls back to
`ishtirak-demo-password`). Override the target with `E2E_BASE_URL` if the web app is
not on `http://localhost:3000`.

The flows are cross-user and depend on real-time pushes, so the config runs a single
worker. Traces, screenshots, and video are retained on failure under
`web/playwright-report/`.
