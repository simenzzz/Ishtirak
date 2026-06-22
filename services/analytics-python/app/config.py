"""Validated runtime configuration, read once at startup from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass

READING_RECORDED_KEY = "reading.recorded"
INVOICE_ISSUED_KEY = "invoice.issued"
PAYMENT_RECEIVED_KEY = "payment.received"


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


@dataclass(frozen=True)
class Settings:
    """Immutable application settings. Built via :func:`load_settings`."""

    rabbitmq_url: str
    redis_url: str
    core_java_url: str
    capture_db_path: str
    analytics_service_token_secret: str
    gateway_service_token_secret: str
    exchange: str = "ishtirak.events"
    reading_queue: str = "analytics.reading-recorded"
    billing_queue: str = "analytics.billing"
    # Dead-letter sink: poison messages and transient failures that survive one retry
    # are routed here instead of being dropped or requeued forever.
    dead_letter_exchange: str = "analytics.dlx"
    dead_letter_queue: str = "analytics.dlq"
    drop_threshold_pct: float = 0.4
    trailing_window: int = 5
    tier_cache_ttl_secs: int = 3600
    # Initial RabbitMQ connect is retried this many times (with the delay below) to
    # ride out the gap between the broker reporting healthy and its AMQP listener
    # accepting connections. Defaults give ~30s of headroom.
    rabbitmq_connect_max_attempts: int = 30
    rabbitmq_connect_retry_delay_secs: int = 1

    @property
    def reading_routing_keys(self) -> tuple[str, ...]:
        return (READING_RECORDED_KEY,)

    @property
    def billing_routing_keys(self) -> tuple[str, ...]:
        return (INVOICE_ISSUED_KEY, PAYMENT_RECEIVED_KEY)


def load_settings(env: dict[str, str] | None = None) -> Settings:
    """Build settings from ``env`` (defaults to ``os.environ``).

    Fails fast with a clear message when a required variable is absent so the
    container crashes at boot rather than at first request.
    """

    source = env if env is not None else dict(os.environ)
    return Settings(
        rabbitmq_url=_required(source, "ISHTIRAK_RABBITMQ_URL"),
        redis_url=_required(source, "ISHTIRAK_REDIS_URL"),
        core_java_url=_required(source, "ISHTIRAK_CORE_JAVA_URL"),
        capture_db_path=_required(source, "ISHTIRAK_CAPTURE_DB_PATH"),
        analytics_service_token_secret=_secret(source, "ISHTIRAK_ANALYTICS_SERVICE_TOKEN_SECRET"),
        gateway_service_token_secret=_secret(source, "ISHTIRAK_GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET"),
        drop_threshold_pct=_float(source, "ANALYTICS_DROP_THRESHOLD_PCT", 0.4),
        trailing_window=_int(source, "ANALYTICS_TRAILING_WINDOW", 5),
        tier_cache_ttl_secs=_int(source, "ANALYTICS_TIER_CACHE_TTL_SECS", 3600),
        rabbitmq_connect_max_attempts=_int(source, "ISHTIRAK_RABBITMQ_CONNECT_MAX_ATTEMPTS", 30),
        rabbitmq_connect_retry_delay_secs=_int(source, "ISHTIRAK_RABBITMQ_CONNECT_RETRY_DELAY_SECS", 1),
    )


def _required(source: dict[str, str], key: str) -> str:
    value = source.get(key, "").strip()
    if not value:
        raise ConfigError(f"missing required environment variable: {key}")
    return value


def _secret(source: dict[str, str], key: str) -> str:
    value = _required(source, key)
    if len(value) < 32:
        raise ConfigError(f"{key} must be at least 32 characters")
    return value


def _float(source: dict[str, str], key: str, default: float) -> float:
    raw = source.get(key, "").strip()
    if not raw:
        return default
    try:
        parsed = float(raw)
    except ValueError as exc:
        raise ConfigError(f"{key} must be a number") from exc
    if not 0 < parsed < 1:
        raise ConfigError(f"{key} must be between 0 and 1 (exclusive)")
    return parsed


def _int(source: dict[str, str], key: str, default: int) -> int:
    raw = source.get(key, "").strip()
    if not raw:
        return default
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{key} must be an integer") from exc
    if parsed <= 0:
        raise ConfigError(f"{key} must be a positive integer")
    return parsed
