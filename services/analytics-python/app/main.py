"""FastAPI application factory and health endpoints.

The theft-detection consumer and analytics routes are wired in during Phase 3;
this module owns app construction, lifespan, and liveness/readiness.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from app.config import Settings, load_settings


class AppState:
    """Mutable runtime state, deliberately tiny and owned by the app instance."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.ready = False


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Phase 3 attaches the RabbitMQ consumer here. For now we are ready
        # as soon as configuration has loaded successfully.
        app.state.ctx.ready = True
        yield
        app.state.ctx.ready = False

    app = FastAPI(title="Ishtirak Analytics", version="0.1.0", lifespan=lifespan)
    app.state.ctx = AppState(resolved)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    async def ready() -> dict[str, bool]:
        return {"ready": app.state.ctx.ready}

    return app
