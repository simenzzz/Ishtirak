"""Reading pipeline: scoring, tier handling, and idempotent redelivery."""

from __future__ import annotations

import uuid

import fakeredis.aioredis
import pytest_asyncio

from app.capture.repository import SqliteCaptureRepository
from app.analytics.core_client import CoreJavaError
from app.consumer.messages import ReadingRecordedEvent
from app.consumer.reading_consumer import ReadingPipeline
from app.redis_state.subscriber_state import get_state
from app.redis_state.tier_cache import TierInfo
from app.rules import rule_set
from tests.conftest import make_settings

_OP = str(uuid.uuid4())
_SUB = str(uuid.uuid4())


class FakePublisher:
    def __init__(self) -> None:
        self.published: list[dict] = []

    async def publish(self, event: dict) -> None:
        self.published.append(event)


class FakeCoreClient:
    def __init__(self, tier: TierInfo | None = None, error: bool = False) -> None:
        self._tier = tier
        self._error = error
        self.calls = 0

    async def get_subscriber_tier(self, operator_id: str, subscriber_id: str) -> TierInfo | None:
        self.calls += 1
        if self._error:
            raise CoreJavaError("boom")
        return self._tier


def _event(kwh: float, reading_at: str, event_id: str | None = None) -> ReadingRecordedEvent:
    return ReadingRecordedEvent.model_validate(
        {
            "eventId": event_id or str(uuid.uuid4()),
            "eventType": "reading.recorded",
            "operatorId": _OP,
            "occurredAt": reading_at,
            "payload": {
                "readingId": str(uuid.uuid4()),
                "subscriberId": _SUB,
                "kwh": kwh,
                "readingAt": reading_at,
            },
        }
    )


@pytest_asyncio.fixture
async def deps():
    redis = fakeredis.aioredis.FakeRedis()
    repo = await SqliteCaptureRepository.connect(":memory:")
    try:
        yield redis, repo
    finally:
        await repo.close()
        await redis.aclose()


def _pipeline(redis, repo, publisher, core_client) -> ReadingPipeline:
    return ReadingPipeline(redis, repo, core_client, publisher, make_settings())


async def test_cold_start_does_not_flag(deps) -> None:
    redis, repo = deps
    publisher = FakePublisher()
    pipeline = _pipeline(redis, repo, publisher, FakeCoreClient())

    event = _event(100.0, "2026-06-18T10:00:00Z")
    await pipeline.process(event, event.model_dump_json())

    assert publisher.published == []
    state = await get_state(redis, _OP, _SUB)
    assert state.previous_kwh == 100.0


async def test_negative_delta_flags_and_publishes(deps) -> None:
    redis, repo = deps
    publisher = FakePublisher()
    pipeline = _pipeline(redis, repo, publisher, FakeCoreClient())

    first = _event(100.0, "2026-06-18T10:00:00Z")
    await pipeline.process(first, first.model_dump_json())
    second = _event(90.0, "2026-06-18T11:00:00Z")  # meter rolled back
    await pipeline.process(second, second.model_dump_json())

    assert len(publisher.published) == 1
    assert publisher.published[0]["payload"]["reason"] == rule_set.NEGATIVE_DELTA
    risk = await repo.find_risk(_OP)
    assert len(risk) == 1


async def test_redelivery_is_idempotent(deps) -> None:
    redis, repo = deps
    publisher = FakePublisher()
    pipeline = _pipeline(redis, repo, publisher, FakeCoreClient())

    first = _event(100.0, "2026-06-18T10:00:00Z")
    await pipeline.process(first, first.model_dump_json())
    second = _event(90.0, "2026-06-18T11:00:00Z")
    await pipeline.process(second, second.model_dump_json())
    state_after_first = await get_state(redis, _OP, _SUB)

    # redeliver the second event verbatim
    await pipeline.process(second, second.model_dump_json())

    assert len(publisher.published) == 1  # no duplicate publish
    assert await get_state(redis, _OP, _SUB) == state_after_first  # delta not double-counted


async def test_exceeds_tier_cap_flags(deps) -> None:
    redis, repo = deps
    publisher = FakePublisher()
    # 5 A tier → max 1.1 kWh/hour; a 50 kWh jump over an hour is impossible
    pipeline = _pipeline(redis, repo, publisher, FakeCoreClient(tier=TierInfo(amperage=5)))

    first = _event(100.0, "2026-06-18T10:00:00Z")
    await pipeline.process(first, first.model_dump_json())
    second = _event(150.0, "2026-06-18T11:00:00Z")
    await pipeline.process(second, second.model_dump_json())

    assert publisher.published[0]["payload"]["reason"] == rule_set.EXCEEDS_TIER_CAP


async def test_tier_lookup_error_skips_rule_without_crashing(deps) -> None:
    redis, repo = deps
    publisher = FakePublisher()
    pipeline = _pipeline(redis, repo, publisher, FakeCoreClient(error=True))

    first = _event(100.0, "2026-06-18T10:00:00Z")
    await pipeline.process(first, first.model_dump_json())
    second = _event(150.0, "2026-06-18T11:00:00Z")  # would exceed a 5A cap, but tier unknown
    await pipeline.process(second, second.model_dump_json())

    # no tier → EXCEEDS_TIER_CAP cannot fire; this clean-ish jump is not otherwise flagged
    assert all(p["payload"]["reason"] != rule_set.EXCEEDS_TIER_CAP for p in publisher.published)


class RaisingPublisher:
    async def publish(self, event: dict) -> None:
        raise RuntimeError("broker down")


async def test_publish_failure_does_not_lose_flag(deps) -> None:
    redis, repo = deps
    pipeline = _pipeline(redis, repo, RaisingPublisher(), FakeCoreClient())

    first = _event(100.0, "2026-06-18T10:00:00Z")
    await pipeline.process(first, first.model_dump_json())
    second = _event(90.0, "2026-06-18T11:00:00Z")  # negative delta → flag
    await pipeline.process(second, second.model_dump_json())  # must not raise

    # flag is durably persisted even though the real-time publish failed
    risk = await repo.find_risk(_OP)
    assert len(risk) == 1
    assert risk[0].reason == rule_set.NEGATIVE_DELTA


async def test_tier_cached_after_first_lookup(deps) -> None:
    redis, repo = deps
    core = FakeCoreClient(tier=TierInfo(amperage=30))
    pipeline = _pipeline(redis, repo, FakePublisher(), core)

    for kwh, ts in [(100.0, "2026-06-18T10:00:00Z"), (105.0, "2026-06-18T11:00:00Z"),
                    (110.0, "2026-06-18T12:00:00Z")]:
        event = _event(kwh, ts)
        await pipeline.process(event, event.model_dump_json())

    assert core.calls == 1  # tier fetched once, then served from Redis cache
