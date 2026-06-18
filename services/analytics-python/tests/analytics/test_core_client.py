"""core-java client: two-call tier fetch, 404 → None, other errors → CoreJavaError."""

from __future__ import annotations

import httpx
import pytest

from app.analytics.core_client import CoreJavaClient, CoreJavaError
from app.redis_state.tier_cache import TierInfo

_OP = "11111111-1111-1111-1111-111111111111"
_SUB = "22222222-2222-2222-2222-222222222222"
_TIER = "33333333-3333-3333-3333-333333333333"
_SECRET = "test-analytics-service-token-secret-32"


def _client(handler) -> CoreJavaClient:
    transport = httpx.MockTransport(handler)
    http = httpx.AsyncClient(transport=transport)
    return CoreJavaClient(http, "http://core-java:8081", _SECRET)


async def test_resolves_amperage_via_two_calls() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        assert request.headers["X-Operator-Id"] == _OP
        assert request.headers["X-Actor-Role"] == "OPERATOR_STAFF"
        assert request.headers["Authorization"].startswith("Bearer ")
        if request.url.path == f"/subscribers/{_SUB}":
            return httpx.Response(200, json={"id": _SUB, "tierId": _TIER})
        if request.url.path == f"/tiers/{_TIER}":
            return httpx.Response(200, json={"id": _TIER, "amperage": 15})
        return httpx.Response(404)

    tier = await _client(handler).get_subscriber_tier(_OP, _SUB)

    assert tier == TierInfo(amperage=15)
    assert seen == [f"/subscribers/{_SUB}", f"/tiers/{_TIER}"]


async def test_unknown_subscriber_returns_none() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    assert await _client(handler).get_subscriber_tier(_OP, _SUB) is None


async def test_server_error_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    with pytest.raises(CoreJavaError):
        await _client(handler).get_subscriber_tier(_OP, _SUB)


async def test_unauthorized_raises_not_silently_skips() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    with pytest.raises(CoreJavaError):
        await _client(handler).get_subscriber_tier(_OP, _SUB)
