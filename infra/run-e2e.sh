#!/usr/bin/env bash
# One-command Playwright E2E run: build + start the full stack with the dev seed,
# wait until login actually works, install Playwright, and run the three showcase
# specs. Uses a dedicated infra/.env.e2e so it never touches your real infra/.env.
#
# Usage:
#   DEMO_PASSWORD=... ./run-e2e.sh        # leaves the stack up for debugging
#   ./run-e2e.sh --down                   # tears the stack down when finished
set -euo pipefail

cd "$(dirname "$0")"
INFRA_DIR="$(pwd)"
ENV_FILE="${INFRA_DIR}/.env.e2e"
COMPOSE=(docker compose --env-file "${ENV_FILE}")
TEARDOWN=true
[ "${1:-}" = "--down" ] && TEARDOWN=true

gen_secret() { openssl rand -base64 48; }

# Generate a fresh, self-contained env. Honour values already exported (so CI can
# pin them); otherwise generate. The demo password defaults to the value the E2E
# helpers fall back to, so the seeded creds and the tests always match.
DEMO_PASSWORD="${DEMO_PASSWORD:-ishtirak-demo-password}"
{
  echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-ishtirak}"
  echo "JWT_SECRET=${JWT_SECRET:-$(gen_secret)}"
  echo "GATEWAY_SERVICE_TOKEN_SECRET=${GATEWAY_SERVICE_TOKEN_SECRET:-$(gen_secret)}"
  echo "GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET=${GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET:-$(gen_secret)}"
  echo "ANALYTICS_SERVICE_TOKEN_SECRET=${ANALYTICS_SERVICE_TOKEN_SECRET:-$(gen_secret)}"
  echo "SERVICE_TOKEN_TTL_SECS=300"
  echo "WEB_ORIGIN=http://localhost:3000"
  echo "COOKIE_SECURE=true"
  echo "REFRESH_COOKIE_MAX_AGE_SECS=2592000"
  echo "AUTH_RATE_LIMIT=${AUTH_RATE_LIMIT:-200}"
  echo "CORE_JAVA_PROFILES=dev"
  echo "DEMO_PASSWORD=${DEMO_PASSWORD}"
} > "${ENV_FILE}"

echo "==> Resetting any previous stack/volumes for a clean, deterministic seed..."
"${COMPOSE[@]}" down -v --remove-orphans

echo "==> Building and starting the stack..."
"${COMPOSE[@]}" up -d --build

echo "==> Waiting for the stack to be ready (real login through the gateway)..."
DEMO_PASSWORD="${DEMO_PASSWORD}" "${INFRA_DIR}/wait-for-login.sh"

echo "==> Installing Playwright and running the E2E suite..."
cd "${INFRA_DIR}/../web"
npm install
npx playwright install --with-deps chromium
DEMO_PASSWORD="${DEMO_PASSWORD}" npm run test:e2e

if [ "${TEARDOWN}" = true ]; then
  echo "==> Tearing down the stack..."
  "${COMPOSE[@]}" down -v
else
  echo "==> Stack left running. Tear down with:"
  echo "    docker compose --env-file ${ENV_FILE} down -v"
fi
