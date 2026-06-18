"""Message-handler wrappers: routing, poison-message handling, and ack semantics."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from app.consumer.billing_consumer import BillingPipeline, make_billing_handler
from app.consumer.reading_consumer import make_reading_handler


class FakeMessage:
    """Minimal stand-in for an aio_pika IncomingMessage."""

    def __init__(self, body: str) -> None:
        self.body = body.encode("utf-8")
        self.processed = False

    def process(self, requeue: bool = True):
        @asynccontextmanager
        async def _ctx():
            self.processed = True
            yield

        return _ctx()


class RecordingReadingPipeline:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def process(self, event, raw_json: str) -> None:
        self.calls.append(str(event.event_id))


def _reading_json() -> str:
    return (
        '{"eventId":"%s","eventType":"reading.recorded","operatorId":"%s",'
        '"occurredAt":"2026-06-18T10:00:00Z","payload":{"readingId":"%s",'
        '"subscriberId":"%s","kwh":100.0,"readingAt":"2026-06-18T10:00:00Z"}}'
    ) % (uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4())


async def test_reading_handler_routes_valid_message() -> None:
    pipeline = RecordingReadingPipeline()
    handler = make_reading_handler(pipeline)
    message = FakeMessage(_reading_json())

    await handler(message)

    assert len(pipeline.calls) == 1
    assert message.processed is True


async def test_reading_handler_drops_poison_without_raising() -> None:
    pipeline = RecordingReadingPipeline()
    handler = make_reading_handler(pipeline)
    message = FakeMessage('{"eventType":"reading.recorded","bogus":true}')

    await handler(message)  # must not raise

    assert pipeline.calls == []


class RecordingBillingPipeline(BillingPipeline):
    def __init__(self) -> None:
        self.invoices = 0
        self.payments = 0

    async def process_invoice(self, event, raw_json: str) -> None:
        self.invoices += 1

    async def process_payment(self, event, raw_json: str) -> None:
        self.payments += 1


async def test_billing_handler_unknown_type_is_dropped() -> None:
    pipeline = RecordingBillingPipeline()
    handler = make_billing_handler(pipeline)
    message = FakeMessage('{"eventType":"outage.scheduled","operatorId":"x"}')

    await handler(message)

    assert pipeline.invoices == 0 and pipeline.payments == 0


async def test_billing_handler_drops_invalid_json() -> None:
    pipeline = RecordingBillingPipeline()
    handler = make_billing_handler(pipeline)
    message = FakeMessage("not json")

    await handler(message)  # must not raise

    assert pipeline.invoices == 0 and pipeline.payments == 0
