"""Liveness/readiness contract for the analytics service."""

from __future__ import annotations

from httpx import ASGITransport, AsyncClient

from app.main import create_app
from tests.conftest import make_settings, noop_runtime

_TEST_SETTINGS = make_settings()


async def test_health_is_ok() -> None:
    app = create_app(_TEST_SETTINGS, runtime_factory=noop_runtime)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_ready_true_after_startup() -> None:
    app = create_app(_TEST_SETTINGS, runtime_factory=noop_runtime)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        app.state.ctx.ready = True
        resp = await client.get("/ready")
    assert resp.status_code == 200
    assert resp.json() == {"ready": True}


async def test_ready_false_before_startup() -> None:
    app = create_app(_TEST_SETTINGS, runtime_factory=noop_runtime)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/ready")
    assert resp.status_code == 503
    assert resp.json() == {"ready": False}
