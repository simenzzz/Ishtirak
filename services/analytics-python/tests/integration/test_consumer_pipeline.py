"""End-to-end pipeline over a real RabbitMQ (Testcontainers).

Skipped automatically when Docker or testcontainers are unavailable.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import aio_pika
import fakeredis.aioredis
import pytest

pytest.importorskip("testcontainers.rabbitmq")
from testcontainers.rabbitmq import RabbitMqContainer  # noqa: E402

from app.capture.repository import SqliteCaptureRepository  # noqa: E402
from app.consumer.billing_consumer import BillingPipeline, make_billing_handler  # noqa: E402
from app.consumer.connection import (  # noqa: E402
    connect,
    declare_billing_queue,
    declare_reading_queue,
)
from app.consumer.reading_consumer import ReadingPipeline, make_reading_handler  # noqa: E402
from app.publisher.reading_flagged import ReadingFlaggedPublisher  # noqa: E402
from app.redis_state.subscriber_state import SubscriberState, save_state  # noqa: E402
from app.redis_state.tier_cache import TierInfo  # noqa: E402
from app.rules import rule_set  # noqa: E402
from tests.conftest import make_settings  # noqa: E402

_OP = str(uuid.uuid4())
_SUB = str(uuid.uuid4())
_INV = str(uuid.uuid4())


class _NoTierClient:
    async def get_subscriber_tier(self, operator_id: str, subscriber_id: str) -> TierInfo | None:
        return None


@pytest.fixture(scope="module")
def rabbitmq_url() -> str:
    try:
        container = RabbitMqContainer("rabbitmq:3.13-management-alpine")
        container.start()
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"RabbitMQ container unavailable: {exc}")
    try:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(5672)
        yield f"amqp://guest:guest@{host}:{port}/"
    finally:
        container.stop()


async def _drain(queue: aio_pika.abc.AbstractQueue, attempts: int = 50) -> aio_pika.abc.AbstractIncomingMessage | None:
    for _ in range(attempts):
        message = await queue.get(fail=False)
        if message is not None:
            return message
        await asyncio.sleep(0.1)
    return None


@pytest.mark.asyncio
async def test_reading_flows_to_flagged_event(rabbitmq_url: str) -> None:
    settings = make_settings(rabbitmq_url=rabbitmq_url)
    broker = await connect(settings)
    redis = fakeredis.aioredis.FakeRedis()
    repo = await SqliteCaptureRepository.connect(":memory:")
    try:
        reading_queue = await declare_reading_queue(broker, settings)
        flagged_queue = await broker.channel.declare_queue("test.flagged", durable=False)
        await flagged_queue.bind(broker.exchange, routing_key="reading.flagged")

        # Pre-seed prior state so a single lower reading triggers NEGATIVE_DELTA.
        await save_state(redis, _OP, _SUB, SubscriberState(100.0, "2026-06-18T10:00:00Z", ()))

        publisher = ReadingFlaggedPublisher.create(broker.exchange)
        pipeline = ReadingPipeline(redis, repo, _NoTierClient(), publisher, settings)
        await reading_queue.consume(make_reading_handler(pipeline))

        reading_id = str(uuid.uuid4())
        await broker.exchange.publish(
            aio_pika.Message(
                body=json.dumps(
                    {
                        "eventId": str(uuid.uuid4()),
                        "eventType": "reading.recorded",
                        "operatorId": _OP,
                        "occurredAt": "2026-06-18T11:00:00Z",
                        "payload": {
                            "readingId": reading_id,
                            "subscriberId": _SUB,
                            "kwh": 90.0,
                            "readingAt": "2026-06-18T11:00:00Z",
                        },
                    }
                ).encode()
            ),
            routing_key="reading.recorded",
        )

        flagged = await _drain(flagged_queue)
        assert flagged is not None, "no reading.flagged event was published"
        payload = json.loads(flagged.body)["payload"]
        await flagged.ack()
        assert payload["reason"] == rule_set.NEGATIVE_DELTA
        assert payload["readingId"] == reading_id

        assert len(await repo.find_risk(_OP)) == 1
    finally:
        await repo.close()
        await redis.aclose()
        await broker.close()


@pytest.mark.asyncio
async def test_billing_events_update_collection_rate(rabbitmq_url: str) -> None:
    settings = make_settings(rabbitmq_url=rabbitmq_url)
    broker = await connect(settings)
    repo = await SqliteCaptureRepository.connect(":memory:")
    try:
        billing_queue = await declare_billing_queue(broker, settings)
        await billing_queue.consume(make_billing_handler(BillingPipeline(repo)))

        await broker.exchange.publish(
            aio_pika.Message(
                body=json.dumps(
                    {
                        "eventId": str(uuid.uuid4()),
                        "eventType": "invoice.issued",
                        "operatorId": _OP,
                        "occurredAt": "2026-06-18T10:00:00Z",
                        "payload": {
                            "invoiceId": _INV,
                            "subscriberId": _SUB,
                            "periodStart": "2026-06-01",
                            "periodEnd": "2026-06-30",
                            "amountUsd": 100.0,
                            "amountLbp": 9_000_000,
                            "kwhConsumed": 250.0,
                        },
                    }
                ).encode()
            ),
            routing_key="invoice.issued",
        )
        await broker.exchange.publish(
            aio_pika.Message(
                body=json.dumps(
                    {
                        "eventId": str(uuid.uuid4()),
                        "eventType": "payment.received",
                        "operatorId": _OP,
                        "occurredAt": "2026-06-18T12:00:00Z",
                        "payload": {
                            "paymentId": str(uuid.uuid4()),
                            "invoiceId": _INV,
                            "subscriberId": _SUB,
                            "currency": "USD",
                            "tenderedAmount": 60.0,
                            "appliedUsd": 60.0,
                            "appliedLbp": 0,
                            "method": "CASH",
                        },
                    }
                ).encode()
            ),
            routing_key="payment.received",
        )

        for _ in range(50):
            rate = await repo.collection_rate(_OP)
            if rate.issued_usd == 100.0 and rate.paid_usd == 60.0:
                break
            await asyncio.sleep(0.1)

        rate = await repo.collection_rate(_OP)
        assert rate.issued_usd == 100.0
        assert rate.paid_usd == 60.0
    finally:
        await repo.close()
        await broker.close()
