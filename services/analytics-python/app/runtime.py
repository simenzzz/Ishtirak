"""Assemble and tear down the live runtime: broker, redis, store, and consumers."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis

from app.analytics.core_client import CoreJavaClient
from app.capture.repository import CaptureRepository, SqliteCaptureRepository
from app.config import Settings
from app.consumer.billing_consumer import BillingPipeline, make_billing_handler
from app.consumer.connection import (
    Broker,
    connect,
    declare_billing_queue,
    declare_reading_queue,
)
from app.consumer.reading_consumer import ReadingPipeline, make_reading_handler
from app.publisher.reading_flagged import ReadingFlaggedPublisher

logger = logging.getLogger(__name__)


@dataclass
class Runtime:
    broker: Broker
    redis: Redis
    http_client: httpx.AsyncClient
    capture_repo: CaptureRepository

    async def aclose(self) -> None:
        await self.broker.close()
        await self.redis.aclose()
        await self.http_client.aclose()
        await self.capture_repo.close()


async def start_runtime(settings: Settings, app: FastAPI) -> Runtime:
    capture_repo = await SqliteCaptureRepository.connect(settings.capture_db_path)
    redis: Redis = Redis.from_url(settings.redis_url)
    http_client = httpx.AsyncClient(timeout=5.0)
    core_client = CoreJavaClient(
        http_client, settings.core_java_url, settings.analytics_service_token_secret
    )

    broker = await connect(settings)
    reading_queue = await declare_reading_queue(broker, settings)
    billing_queue = await declare_billing_queue(broker, settings)
    publisher = ReadingFlaggedPublisher.create(broker.exchange)

    reading_pipeline = ReadingPipeline(redis, capture_repo, core_client, publisher, settings)
    billing_pipeline = BillingPipeline(capture_repo)
    await reading_queue.consume(make_reading_handler(reading_pipeline))
    await billing_queue.consume(make_billing_handler(billing_pipeline))

    app.state.capture_repo = capture_repo
    logger.info("analytics runtime started: consuming readings and billing events")
    return Runtime(broker=broker, redis=redis, http_client=http_client, capture_repo=capture_repo)
