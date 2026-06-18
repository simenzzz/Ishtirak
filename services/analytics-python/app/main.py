"""FastAPI application factory, lifespan wiring, and health endpoints.

The lifespan starts the RabbitMQ consumers and analytics REST surface via an
injectable ``runtime_factory`` so tests can run the app without live infrastructure.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator, Awaitable, Callable

from fastapi import FastAPI, status
from fastapi.responses import JSONResponse

from app.analytics.router import router as analytics_router
from app.config import Settings, load_settings
from app.runtime import Runtime, start_runtime

RuntimeFactory = Callable[[Settings, FastAPI], Awaitable[Runtime | None]]


class AppState:
    """Mutable runtime state, deliberately tiny and owned by the app instance."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.ready = False


def create_app(
    settings: Settings | None = None,
    *,
    runtime_factory: RuntimeFactory = start_runtime,
) -> FastAPI:
    resolved = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        runtime = await runtime_factory(resolved, app)
        app.state.ctx.ready = True
        try:
            yield
        finally:
            app.state.ctx.ready = False
            if runtime is not None:
                await runtime.aclose()

    app = FastAPI(title="Ishtirak Analytics", version="0.1.0", lifespan=lifespan)
    app.state.ctx = AppState(resolved)
    app.state.capture_repo = None
    app.include_router(analytics_router)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    async def ready() -> JSONResponse:
        if not app.state.ctx.ready:
            return JSONResponse({"ready": False}, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        return JSONResponse({"ready": True})

    return app
