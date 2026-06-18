"""Rolling subscriber state read/write and the pure ``roll`` transition."""

from __future__ import annotations

import fakeredis.aioredis
import pytest_asyncio

from app.redis_state.subscriber_state import (
    SubscriberState,
    get_state,
    roll,
    save_state,
)

_OP = "op-1"
_SUB = "sub-1"


@pytest_asyncio.fixture
async def redis() -> fakeredis.aioredis.FakeRedis:
    client = fakeredis.aioredis.FakeRedis()
    try:
        yield client
    finally:
        await client.aclose()


async def test_get_returns_none_when_absent(redis: fakeredis.aioredis.FakeRedis) -> None:
    assert await get_state(redis, _OP, _SUB) is None


async def test_round_trip_preserves_state(redis: fakeredis.aioredis.FakeRedis) -> None:
    state = SubscriberState(100.0, "2026-06-18T10:00:00Z", (5.0, 4.0))
    await save_state(redis, _OP, _SUB, state)

    assert await get_state(redis, _OP, _SUB) == state


def test_roll_cold_start_records_no_delta() -> None:
    state = roll(None, kwh=100.0, reading_at="2026-06-18T10:00:00Z", delta=None, window=5)

    assert state.previous_kwh == 100.0
    assert state.previous_reading_at == "2026-06-18T10:00:00Z"
    assert state.trailing_deltas == ()


def test_roll_prepends_and_truncates_window() -> None:
    previous = SubscriberState(100.0, "2026-06-18T10:00:00Z", (3.0, 2.0))
    state = roll(previous, kwh=110.0, reading_at="2026-06-18T11:00:00Z", delta=10.0, window=2)

    assert state.trailing_deltas == (10.0, 3.0)
    assert state.previous_kwh == 110.0


def test_roll_does_not_mutate_previous() -> None:
    previous = SubscriberState(100.0, "2026-06-18T10:00:00Z", (3.0,))
    roll(previous, kwh=110.0, reading_at="2026-06-18T11:00:00Z", delta=10.0, window=5)

    assert previous.trailing_deltas == (3.0,)
