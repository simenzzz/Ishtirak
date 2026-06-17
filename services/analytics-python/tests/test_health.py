"""Liveness/readiness contract for the analytics service."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

_TEST_SETTINGS = Settings(
    rabbitmq_url="amqp://guest:guest@localhost:5672/",
    redis_url="redis://localhost:6379/0",
)


def test_health_is_ok() -> None:
    app = create_app(_TEST_SETTINGS)
    with TestClient(app) as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


def test_ready_true_after_startup() -> None:
    app = create_app(_TEST_SETTINGS)
    with TestClient(app) as client:  # triggers lifespan startup
        resp = client.get("/ready")
        assert resp.status_code == 200
        assert resp.json() == {"ready": True}
