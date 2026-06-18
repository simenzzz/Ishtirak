"""Shared test helpers for the analytics suite."""

from __future__ import annotations

from fastapi import FastAPI

from app.config import Settings

_ANALYTICS_SECRET = "test-analytics-service-token-secret-32"
_GATEWAY_SECRET = "test-gateway-service-token-secret-32"


async def noop_runtime(settings: Settings, app: FastAPI) -> None:
    """A runtime factory that starts no infrastructure (for tests)."""

    return None


def make_settings(**overrides: object) -> Settings:
    """Build a fully-populated :class:`Settings` for tests, with optional overrides."""

    defaults: dict[str, object] = {
        "rabbitmq_url": "amqp://guest:guest@localhost:5672/",
        "redis_url": "redis://localhost:6379/0",
        "core_java_url": "http://core-java:8081",
        "capture_db_path": ":memory:",
        "analytics_service_token_secret": _ANALYTICS_SECRET,
        "gateway_service_token_secret": _GATEWAY_SECRET,
    }
    defaults.update(overrides)
    return Settings(**defaults)  # type: ignore[arg-type]
