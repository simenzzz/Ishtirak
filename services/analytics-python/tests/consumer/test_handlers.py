"""Message-handler wrappers: routing, poison dead-lettering, retry, and ack semantics."""

from __future__ import annotations

import uuid

import pytest

from app.consumer.billing_consumer import BillingPipeline, make_billing_handler
from app.consumer.reading_consumer import make_reading_handler


class FakeMessage:
    """Minimal stand-in for an aio_pika IncomingMessage recording ack/reject calls."""

    def __init__(self, body: str, redelivered: bool = False) -> None:
        self.body = body.encode("utf-8")
        self.redelivered = redelivered
        self.acked = False
        self.rejected_requeue: bool | None = None

    async def ack(self) -> None:
        self.acked = True

    async def reject(self, requeue: bool = False) -> None:
        self.rejected_requeue = requeue


class RecordingReadingPipeline:
    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[str] = []
        self.error = error

    async def process(self, event, raw_json: str) -> None:
        if self.error is not None:
            raise self.error
        self.calls.append(str(event.event_id))


def _reading_json() -> str:
    return (
        '{"eventId":"%s","eventType":"reading.recorded","operatorId":"%s",'
        '"occurredAt":"2026-06-18T10:00:00Z","payload":{"readingId":"%s",'
        '"subscriberId":"%s","kwh":100.0,"readingAt":"2026-06-18T10:00:00Z"}}'
    ) % (uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4())


async def test_reading_handler_acks_valid_message() -> None:
    pipeline = RecordingReadingPipeline()
    handler = make_reading_handler(pipeline)
    message = FakeMessage(_reading_json())

    await handler(message)

    assert len(pipeline.calls) == 1
    assert message.acked is True
    assert message.rejected_requeue is None


async def test_reading_handler_dead_letters_poison_without_requeue() -> None:
    pipeline = RecordingReadingPipeline()
    handler = make_reading_handler(pipeline)
    message = FakeMessage('{"eventType":"reading.recorded","bogus":true}')

    await handler(message)  # must not raise

    assert pipeline.calls == []
    assert message.acked is False
    assert message.rejected_requeue is False


async def test_reading_handler_requeues_once_on_transient_failure() -> None:
    pipeline = RecordingReadingPipeline(error=RuntimeError("redis down"))
    handler = make_reading_handler(pipeline)
    message = FakeMessage(_reading_json(), redelivered=False)

    await handler(message)

    assert message.rejected_requeue is True


async def test_reading_handler_dead_letters_after_redelivery() -> None:
    pipeline = RecordingReadingPipeline(error=RuntimeError("redis down"))
    handler = make_reading_handler(pipeline)
    message = FakeMessage(_reading_json(), redelivered=True)

    await handler(message)

    assert message.rejected_requeue is False


class RecordingBillingPipeline(BillingPipeline):
    def __init__(self) -> None:
        self.invoices = 0
        self.payments = 0

    async def process_invoice(self, event, raw_json: str) -> None:
        self.invoices += 1

    async def process_payment(self, event, raw_json: str) -> None:
        self.payments += 1


@pytest.mark.parametrize(
    "body",
    [
        '{"eventType":"outage.scheduled","operatorId":"x"}',  # unknown type
        "not json",  # invalid json
    ],
)
async def test_billing_handler_dead_letters_poison(body: str) -> None:
    pipeline = RecordingBillingPipeline()
    handler = make_billing_handler(pipeline)
    message = FakeMessage(body)

    await handler(message)  # must not raise

    assert pipeline.invoices == 0 and pipeline.payments == 0
    assert message.rejected_requeue is False
    assert message.acked is False
