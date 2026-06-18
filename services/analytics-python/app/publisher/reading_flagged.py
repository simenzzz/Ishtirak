"""Build, validate, and publish ``reading.flagged`` events.

An event that fails contract validation is logged at CRITICAL and never published —
producers must not be able to drift from the source-of-truth schema.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

import aio_pika
from jsonschema import ValidationError
from jsonschema.protocols import Validator

from app.publisher.schema import load_validator

logger = logging.getLogger(__name__)

EVENT_TYPE = "reading.flagged"
ROUTING_KEY = "reading.flagged"
SCHEMA_NAME = "reading-flagged.schema.json"


def build_reading_flagged(
    operator_id: str,
    reading_id: str,
    subscriber_id: str,
    reason: str,
    score: float,
    occurred_at: str | None = None,
) -> dict:
    return {
        "eventId": str(uuid.uuid4()),
        "eventType": EVENT_TYPE,
        "operatorId": operator_id,
        "occurredAt": occurred_at or _now_iso(),
        "payload": {
            "readingId": reading_id,
            "subscriberId": subscriber_id,
            "reason": reason,
            "score": score,
        },
    }


class ReadingFlaggedPublisher:
    def __init__(self, exchange: aio_pika.abc.AbstractExchange, validator: Validator) -> None:
        self._exchange = exchange
        self._validator = validator

    @classmethod
    def create(cls, exchange: aio_pika.abc.AbstractExchange) -> "ReadingFlaggedPublisher":
        return cls(exchange, load_validator(SCHEMA_NAME))

    async def publish(self, event: dict) -> None:
        try:
            self._validator.validate(event)
        except ValidationError as exc:
            logger.critical("refusing to publish invalid reading.flagged event: %s", exc.message)
            raise
        message = aio_pika.Message(
            body=json.dumps(event).encode("utf-8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )
        await self._exchange.publish(message, routing_key=ROUTING_KEY)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
