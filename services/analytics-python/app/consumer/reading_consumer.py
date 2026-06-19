"""Consume ``reading.recorded``: score for tampering and emit ``reading.flagged``.

The capture write is the idempotency gate: a redelivered event is recorded once and
short-circuits before any risk flag is published or rolling state is updated, so
redelivery never double-publishes or double-counts consumption.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import aio_pika
from pydantic import ValidationError
from redis.asyncio import Redis

from app.analytics.core_client import CoreJavaClient, CoreJavaError
from app.capture.models import CapturedEvent, RiskFlag
from app.capture.repository import CaptureRepository
from app.clock import now_iso
from app.config import Settings
from app.consumer.dispatch import PoisonMessage, dispatch
from app.consumer.messages import ReadingRecordedEvent
from app.publisher.reading_flagged import ReadingFlaggedPublisher, build_reading_flagged
from app.redis_state.subscriber_state import get_state, roll, save_state
from app.redis_state.tier_cache import TierInfo, get_tier, save_tier
from app.rules.engine import apply_rules
from app.rules.features import extract

logger = logging.getLogger(__name__)


@dataclass
class ReadingPipeline:
    redis: Redis
    capture_repo: CaptureRepository
    core_client: CoreJavaClient
    publisher: ReadingFlaggedPublisher
    settings: Settings

    async def process(self, event: ReadingRecordedEvent, raw_json: str) -> None:
        operator_id = str(event.operator_id)
        subscriber_id = str(event.payload.subscriber_id)
        reading_id = str(event.payload.reading_id)
        reading_at = event.payload.reading_at.isoformat()

        captured = CapturedEvent(
            event_id=str(event.event_id),
            event_type=event.event_type,
            operator_id=operator_id,
            subscriber_id=subscriber_id,
            raw_json=raw_json,
            captured_at=now_iso(),
        )
        if not await self.capture_repo.save_event(captured):
            logger.info("reading event %s already processed; skipping", event.event_id)
            return

        state = await get_state(self.redis, operator_id, subscriber_id)
        tier = await self._tier(operator_id, subscriber_id)
        features = extract(event.payload.kwh, reading_at, state, tier)
        result = apply_rules(features, self.settings)

        # Advance rolling state exactly once (the capture gate above prevents replay).
        next_state = roll(
            state, event.payload.kwh, reading_at, features.delta, self.settings.trailing_window
        )
        await save_state(self.redis, operator_id, subscriber_id, next_state)

        if result is not None:
            # Persist the flag durably first, then publish best-effort: a publish
            # failure must not poison the idempotency gate or lose the scored flag.
            await self.capture_repo.save_risk_flag(
                RiskFlag(reading_id, operator_id, subscriber_id, result.reason, result.score, now_iso())
            )
            await self._publish(operator_id, reading_id, subscriber_id, result)

    async def _publish(self, operator_id: str, reading_id: str, subscriber_id: str, result) -> None:
        try:
            await self.publisher.publish(
                build_reading_flagged(
                    operator_id, reading_id, subscriber_id, result.reason, result.score
                )
            )
        except Exception as exc:  # noqa: BLE001 - flag is already persisted; push is best-effort
            logger.error(
                "reading.flagged publish failed for reading %s; flag persisted, push skipped: %s",
                reading_id,
                exc,
            )

    async def _tier(self, operator_id: str, subscriber_id: str) -> TierInfo | None:
        cached = await get_tier(self.redis, operator_id, subscriber_id)
        if cached is not None:
            return cached
        try:
            tier = await self.core_client.get_subscriber_tier(operator_id, subscriber_id)
        except CoreJavaError:
            logger.warning(
                "tier lookup failed for %s/%s; tier-cap rule skipped for this reading",
                operator_id,
                subscriber_id,
            )
            return None
        if tier is not None:
            await save_tier(
                self.redis, operator_id, subscriber_id, tier, self.settings.tier_cache_ttl_secs
            )
        return tier


def make_reading_handler(pipeline: ReadingPipeline):
    async def handle(raw: str) -> None:
        try:
            event = ReadingRecordedEvent.model_validate_json(raw)
        except ValidationError as exc:
            raise PoisonMessage(f"invalid reading.recorded message: {exc}") from exc
        await pipeline.process(event, raw)

    async def handler(message: aio_pika.abc.AbstractIncomingMessage) -> None:
        await dispatch(message, handle)

    return handler
