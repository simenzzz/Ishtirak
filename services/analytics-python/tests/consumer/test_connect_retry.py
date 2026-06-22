"""Initial-connect retry/backoff for the RabbitMQ broker connection."""

from __future__ import annotations

import pytest
from aio_pika.exceptions import AMQPConnectionError

from app.consumer.connection import connect_robust_with_retry
from tests.conftest import make_settings


class _RecordingSleep:
    """Async sleep stand-in that records each requested delay instead of waiting."""

    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


@pytest.mark.asyncio
async def test_returns_connection_on_first_success() -> None:
    sleep = _RecordingSleep()
    sentinel = object()
    calls = 0

    async def connector(url: str) -> object:
        nonlocal calls
        calls += 1
        return sentinel

    settings = make_settings(rabbitmq_connect_max_attempts=5, rabbitmq_connect_retry_delay_secs=2)
    result = await connect_robust_with_retry(settings, connector=connector, sleep=sleep)  # type: ignore[arg-type]

    assert result is sentinel
    assert calls == 1
    assert sleep.delays == []


@pytest.mark.asyncio
async def test_retries_then_succeeds() -> None:
    sleep = _RecordingSleep()
    sentinel = object()
    attempts = 0

    async def connector(url: str) -> object:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise AMQPConnectionError("connection refused")
        return sentinel

    settings = make_settings(rabbitmq_connect_max_attempts=5, rabbitmq_connect_retry_delay_secs=2)
    result = await connect_robust_with_retry(settings, connector=connector, sleep=sleep)  # type: ignore[arg-type]

    assert result is sentinel
    assert attempts == 3
    assert sleep.delays == [2, 2]


@pytest.mark.asyncio
async def test_raises_last_error_after_exhausting_attempts() -> None:
    sleep = _RecordingSleep()
    last_error = AMQPConnectionError("still refused")
    attempts = 0

    async def connector(url: str) -> object:
        nonlocal attempts
        attempts += 1
        raise last_error

    settings = make_settings(rabbitmq_connect_max_attempts=3, rabbitmq_connect_retry_delay_secs=1)
    with pytest.raises(AMQPConnectionError) as excinfo:
        await connect_robust_with_retry(settings, connector=connector, sleep=sleep)  # type: ignore[arg-type]

    assert excinfo.value is last_error
    assert attempts == 3
    assert sleep.delays == [1, 1]
