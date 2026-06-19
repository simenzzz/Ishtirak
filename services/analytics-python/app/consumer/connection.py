"""RabbitMQ connection, topic exchange, and durable queue bindings."""

from __future__ import annotations

from dataclasses import dataclass

import aio_pika

from app.config import Settings


@dataclass
class Broker:
    connection: aio_pika.abc.AbstractRobustConnection
    channel: aio_pika.abc.AbstractChannel
    exchange: aio_pika.abc.AbstractExchange

    async def close(self) -> None:
        await self.connection.close()


async def connect(settings: Settings) -> Broker:
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=16)
    exchange = await channel.declare_exchange(
        settings.exchange, aio_pika.ExchangeType.TOPIC, durable=True
    )
    # A single fanout dead-letter exchange + queue collects rejected messages from
    # every consumer queue for later inspection/replay.
    dlx = await channel.declare_exchange(
        settings.dead_letter_exchange, aio_pika.ExchangeType.FANOUT, durable=True
    )
    # Bound the sink so a flood of poison/failed messages can't grow unbounded on the
    # broker; oldest entries are dropped once the cap is hit.
    dlq = await channel.declare_queue(
        settings.dead_letter_queue, durable=True, arguments={"x-max-length": 10000}
    )
    await dlq.bind(dlx)
    return Broker(connection=connection, channel=channel, exchange=exchange)


async def declare_reading_queue(broker: Broker, settings: Settings) -> aio_pika.abc.AbstractQueue:
    return await _bind(broker, settings, settings.reading_queue, settings.reading_routing_keys)


async def declare_billing_queue(broker: Broker, settings: Settings) -> aio_pika.abc.AbstractQueue:
    return await _bind(broker, settings, settings.billing_queue, settings.billing_routing_keys)


async def _bind(
    broker: Broker, settings: Settings, queue_name: str, routing_keys: tuple[str, ...]
) -> aio_pika.abc.AbstractQueue:
    # Rejected messages (poison, or transient failures past one retry) dead-letter to
    # the shared sink rather than vanishing.
    queue = await broker.channel.declare_queue(
        queue_name,
        durable=True,
        arguments={"x-dead-letter-exchange": settings.dead_letter_exchange},
    )
    for routing_key in routing_keys:
        await queue.bind(broker.exchange, routing_key=routing_key)
    return queue
