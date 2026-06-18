"""ReadingFlaggedPublisher validates before publishing and refuses invalid events."""

from __future__ import annotations

import uuid

import pytest
from jsonschema import ValidationError

from app.publisher.reading_flagged import (
    ROUTING_KEY,
    ReadingFlaggedPublisher,
    build_reading_flagged,
)
from app.publisher.schema import load_validator
from app.rules import rule_set


class FakeExchange:
    def __init__(self) -> None:
        self.published: list[tuple[bytes, str]] = []

    async def publish(self, message, routing_key: str) -> None:
        self.published.append((message.body, routing_key))


def _publisher() -> tuple[ReadingFlaggedPublisher, FakeExchange]:
    exchange = FakeExchange()
    return ReadingFlaggedPublisher(exchange, load_validator("reading-flagged.schema.json")), exchange


async def test_valid_event_is_published_with_routing_key() -> None:
    publisher, exchange = _publisher()
    event = build_reading_flagged(
        str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), rule_set.ZERO_DELTA, 0.8
    )

    await publisher.publish(event)

    assert len(exchange.published) == 1
    assert exchange.published[0][1] == ROUTING_KEY


async def test_invalid_event_is_not_published() -> None:
    publisher, exchange = _publisher()
    bad = build_reading_flagged(
        str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), "NOT_A_REASON", 9.0
    )

    with pytest.raises(ValidationError):
        await publisher.publish(bad)

    assert exchange.published == []
