"""Liveness/readiness contract for the analytics service."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_settings, noop_runtime

_TEST_SETTINGS = make_settings()


def test_health_is_ok() -> None:
    app = create_app(_TEST_SETTINGS, runtime_factory=noop_runtime)
    with TestClient(app) as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


def test_ready_true_after_startup() -> None:
    app = create_app(_TEST_SETTINGS, runtime_factory=noop_runtime)
    with TestClient(app) as client:  # triggers lifespan startup
        resp = client.get("/ready")
        assert resp.status_code == 200
        assert resp.json() == {"ready": True}
