"""Analytics REST endpoints: service-token auth, scoping, and contract shapes."""

from __future__ import annotations

import time
import uuid

import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.analytics.jws import encode_segment, sign
from app.analytics.router import router
from app.capture.models import InvoiceLedgerEntry, RiskFlag
from app.capture.repository import SqliteCaptureRepository
from tests.conftest import make_settings

_OP = str(uuid.uuid4())
_OTHER_OP = str(uuid.uuid4())
_SUB = str(uuid.uuid4())
_SECRET = "test-gateway-service-token-secret-32"


@pytest_asyncio.fixture
async def client():
    repo = await SqliteCaptureRepository.connect(":memory:")
    app = FastAPI()
    app.state.ctx = type("Ctx", (), {"settings": make_settings(gateway_service_token_secret=_SECRET)})()
    app.state.capture_repo = repo
    app.include_router(router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http, repo
    await repo.close()


def _headers(operator_id: str = _OP, role: str = "OPERATOR_STAFF") -> dict[str, str]:
    header = encode_segment({"alg": "HS256", "typ": "JWT"})
    payload = encode_segment(
        {
            "iss": "gateway-node",
            "aud": "analytics-python",
            "typ": "service",
            "exp": int(time.time()) + 300,
            "operatorId": operator_id,
            "role": role,
        }
    )
    token = f"{header}.{payload}.{sign(f'{header}.{payload}', _SECRET)}"
    return {"Authorization": f"Bearer {token}", "X-Operator-Id": operator_id, "X-Actor-Role": role}


async def _seed_flag(repo: SqliteCaptureRepository, reading_id: str, operator_id: str = _OP) -> None:
    await repo.save_risk_flag(
        RiskFlag(reading_id, operator_id, _SUB, "NEGATIVE_DELTA", 1.0, "2026-06-18T10:00:00Z")
    )


async def test_missing_service_token_is_401(client) -> None:
    http, _ = client
    resp = await http.get("/analytics/risk", headers={"X-Operator-Id": _OP})
    assert resp.status_code == 401


async def test_operator_header_mismatch_is_403(client) -> None:
    http, _ = client
    headers = dict(_headers(_OP), **{"X-Operator-Id": _OTHER_OP})
    resp = await http.get("/analytics/risk", headers=headers)
    assert resp.status_code == 403


async def test_subscriber_role_is_403(client) -> None:
    http, _ = client
    resp = await http.get("/analytics/risk", headers=_headers(role="SUBSCRIBER"))
    assert resp.status_code == 403


async def test_list_risk_is_operator_scoped_and_paginated(client) -> None:
    http, repo = client
    mine = str(uuid.uuid4())
    await _seed_flag(repo, mine)
    await _seed_flag(repo, str(uuid.uuid4()), operator_id=_OTHER_OP)

    resp = await http.get("/analytics/risk?page=1&limit=20&minScore=0.5", headers=_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"] == {"total": 1, "page": 1, "limit": 20}
    assert body["data"][0]["readingId"] == mine
    assert body["data"][0]["label"] == "UNREVIEWED"
    assert body["data"][0]["scoredAt"] == "2026-06-18T10:00:00Z"


async def test_get_risk_404_when_absent(client) -> None:
    http, _ = client
    resp = await http.get(f"/analytics/risk/{uuid.uuid4()}", headers=_headers())
    assert resp.status_code == 404


async def test_label_persists_and_returns_updated_flag(client) -> None:
    http, repo = client
    reading_id = str(uuid.uuid4())
    await _seed_flag(repo, reading_id)

    resp = await http.post(
        f"/analytics/risk/{reading_id}/label", json={"label": "CONFIRMED"}, headers=_headers()
    )

    assert resp.status_code == 200
    assert resp.json()["label"] == "CONFIRMED"


async def test_collection_rate_contract_shape(client) -> None:
    http, repo = client
    await repo.upsert_invoice(
        InvoiceLedgerEntry(str(uuid.uuid4()), _OP, "2026-06-01", "2026-06-30", 100.0, 9_000_000, 0.0, 0)
    )
    await repo.upsert_invoice(
        InvoiceLedgerEntry(str(uuid.uuid4()), _OP, "2026-05-01", "2026-05-31", 50.0, 4_500_000, 0.0, 0)
    )
    resp = await http.get(
        "/analytics/collection-rate?periodStart=2026-06-01&periodEnd=2026-06-30",
        headers=_headers(),
    )

    assert resp.status_code == 200
    assert resp.json() == [
        {
            "periodStart": "2026-06-01",
            "periodEnd": "2026-06-30",
            "issuedUsd": 100.0,
            "issuedLbp": 9_000_000,
            "collectedUsd": 0.0,
            "collectedLbp": 0,
            "rate": 0.0,
        }
    ]
