"""Analytics REST endpoints: operator scoping, risk queries, and labelling."""

from __future__ import annotations

import uuid

import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.analytics.router import router
from app.capture.models import RiskFlag
from app.capture.repository import SqliteCaptureRepository

_OP = str(uuid.uuid4())
_OTHER_OP = str(uuid.uuid4())
_SUB = str(uuid.uuid4())
_HEADERS = {"X-Operator-Id": _OP}


@pytest_asyncio.fixture
async def client():
    repo = await SqliteCaptureRepository.connect(":memory:")
    app = FastAPI()
    app.state.capture_repo = repo
    app.include_router(router)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http, repo
    await repo.close()


async def _seed_flag(repo: SqliteCaptureRepository, reading_id: str, operator_id: str = _OP) -> None:
    await repo.save_risk_flag(
        RiskFlag(reading_id, operator_id, _SUB, "NEGATIVE_DELTA", 1.0, "2026-06-18T10:00:00Z")
    )


async def test_missing_operator_header_is_400(client) -> None:
    http, _ = client
    resp = await http.get("/analytics/risk")
    assert resp.status_code == 400


async def test_invalid_operator_header_is_400(client) -> None:
    http, _ = client
    resp = await http.get("/analytics/risk", headers={"X-Operator-Id": "not-a-uuid"})
    assert resp.status_code == 400


async def test_list_risk_is_operator_scoped(client) -> None:
    http, repo = client
    mine = str(uuid.uuid4())
    await _seed_flag(repo, mine)
    await _seed_flag(repo, str(uuid.uuid4()), operator_id=_OTHER_OP)

    resp = await http.get("/analytics/risk", headers=_HEADERS)

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert [f["readingId"] for f in data] == [mine]


async def test_get_risk_404_when_absent(client) -> None:
    http, _ = client
    resp = await http.get(f"/analytics/risk/{uuid.uuid4()}", headers=_HEADERS)
    assert resp.status_code == 404


async def test_label_requires_existing_flag(client) -> None:
    http, _ = client
    resp = await http.post(
        f"/analytics/risk/{uuid.uuid4()}/label", json={"confirmed": True}, headers=_HEADERS
    )
    assert resp.status_code == 404


async def test_label_persists(client) -> None:
    http, repo = client
    reading_id = str(uuid.uuid4())
    await _seed_flag(repo, reading_id)

    resp = await http.post(
        f"/analytics/risk/{reading_id}/label", json={"confirmed": True}, headers=_HEADERS
    )

    assert resp.status_code == 204


async def test_collection_rate_summary(client) -> None:
    http, _ = client
    resp = await http.get("/analytics/collection-rate", headers=_HEADERS)

    assert resp.status_code == 200
    body = resp.json()
    assert body["operatorId"] == _OP
    assert body["invoiceCount"] == 0
