"""Tier cache hit/miss and TTL expiry."""

from __future__ import annotations

import fakeredis.aioredis
import pytest_asyncio

from app.redis_state.tier_cache import TierInfo, get_tier, save_tier

_OP = "op-1"
_SUB = "sub-1"


@pytest_asyncio.fixture
async def redis() -> fakeredis.aioredis.FakeRedis:
    client = fakeredis.aioredis.FakeRedis()
    try:
        yield client
    finally:
        await client.aclose()


async def test_miss_returns_none(redis: fakeredis.aioredis.FakeRedis) -> None:
    assert await get_tier(redis, _OP, _SUB) is None


async def test_hit_returns_saved_tier(redis: fakeredis.aioredis.FakeRedis) -> None:
    await save_tier(redis, _OP, _SUB, TierInfo(amperage=15), ttl_secs=3600)

    assert await get_tier(redis, _OP, _SUB) == TierInfo(amperage=15)


async def test_ttl_is_applied(redis: fakeredis.aioredis.FakeRedis) -> None:
    await save_tier(redis, _OP, _SUB, TierInfo(amperage=5), ttl_secs=120)

    ttl = await redis.ttl("analytics:tier:op-1:sub-1")
    assert 0 < ttl <= 120
