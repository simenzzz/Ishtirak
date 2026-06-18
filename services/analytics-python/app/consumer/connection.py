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
    return Broker(connection=connection, channel=channel, exchange=exchange)


async def declare_reading_queue(broker: Broker, settings: Settings) -> aio_pika.abc.AbstractQueue:
    return await _bind(broker, settings.reading_queue, settings.reading_routing_keys)


async def declare_billing_queue(broker: Broker, settings: Settings) -> aio_pika.abc.AbstractQueue:
    return await _bind(broker, settings.billing_queue, settings.billing_routing_keys)


async def _bind(
    broker: Broker, queue_name: str, routing_keys: tuple[str, ...]
) -> aio_pika.abc.AbstractQueue:
    queue = await broker.channel.declare_queue(queue_name, durable=True)
    for routing_key in routing_keys:
        await queue.bind(broker.exchange, routing_key=routing_key)
    return queue
