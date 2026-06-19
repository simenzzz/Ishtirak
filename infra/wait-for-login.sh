#!/usr/bin/env bash
# Block until the stack is genuinely ready end-to-end: a real login through the
# gateway returns 200. Unlike the gateway's /ready probe (which only checks the
# gateway's own Redis/RabbitMQ connections), a 200 here proves the gateway is up,
# core-java is reachable, AND the dev-profile demo seed has created the users — so
# the first E2E login can't race a 502 on a cold start.
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
EMAIL="${E2E_LOGIN_EMAIL:-admin@ishtirak.local}"
PASSWORD="${DEMO_PASSWORD:-ishtirak-demo-password}"
TIMEOUT_SECS="${WAIT_TIMEOUT_SECS:-180}"
INTERVAL_SECS="${WAIT_INTERVAL_SECS:-5}"

deadline=$(( $(date +%s) + TIMEOUT_SECS ))
attempt=0
while true; do
  attempt=$(( attempt + 1 ))
  status=$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "${GATEWAY_URL}/api/auth/login" \
    -H 'content-type: application/json' \
    --data "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" || true)
  if [ "${status}" = "200" ]; then
    echo "stack ready: login succeeded after ${attempt} attempt(s)"
    exit 0
  fi
  if [ "$(date +%s)" -ge "${deadline}" ]; then
    echo "timed out after ${TIMEOUT_SECS}s waiting for a successful login (last status: ${status})" >&2
    exit 1
  fi
  echo "waiting for stack readiness (attempt ${attempt}, last status: ${status})..."
  sleep "${INTERVAL_SECS}"
done
