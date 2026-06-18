"""Validation behaviour of :func:`app.config.load_settings`."""

from __future__ import annotations

import pytest

from app.config import ConfigError, load_settings

_BASE_ENV = {
    "ISHTIRAK_RABBITMQ_URL": "amqp://guest:guest@localhost:5672/",
    "ISHTIRAK_REDIS_URL": "redis://localhost:6379/0",
    "ISHTIRAK_CORE_JAVA_URL": "http://core-java:8081",
    "ISHTIRAK_CAPTURE_DB_PATH": "/data/capture.db",
    "ISHTIRAK_ANALYTICS_SERVICE_TOKEN_SECRET": "x" * 32,
}


def test_loads_with_defaults() -> None:
    settings = load_settings(dict(_BASE_ENV))

    assert settings.drop_threshold_pct == 0.4
    assert settings.trailing_window == 5
    assert settings.tier_cache_ttl_secs == 3600
    assert settings.reading_routing_keys == ("reading.recorded",)
    assert settings.billing_routing_keys == ("invoice.issued", "payment.received")


@pytest.mark.parametrize("missing", sorted(_BASE_ENV))
def test_missing_required_var_fails_fast(missing: str) -> None:
    env = {k: v for k, v in _BASE_ENV.items() if k != missing}

    with pytest.raises(ConfigError):
        load_settings(env)


def test_short_secret_rejected() -> None:
    env = dict(_BASE_ENV, ISHTIRAK_ANALYTICS_SERVICE_TOKEN_SECRET="too-short")

    with pytest.raises(ConfigError):
        load_settings(env)


@pytest.mark.parametrize("value", ["0", "1", "1.5", "nan-ish"])
def test_invalid_drop_threshold_rejected(value: str) -> None:
    env = dict(_BASE_ENV, ANALYTICS_DROP_THRESHOLD_PCT=value)

    with pytest.raises(ConfigError):
        load_settings(env)


def test_overrides_parsed() -> None:
    env = dict(
        _BASE_ENV,
        ANALYTICS_DROP_THRESHOLD_PCT="0.6",
        ANALYTICS_TRAILING_WINDOW="10",
        ANALYTICS_TIER_CACHE_TTL_SECS="900",
    )

    settings = load_settings(env)

    assert settings.drop_threshold_pct == 0.6
    assert settings.trailing_window == 10
    assert settings.tier_cache_ttl_secs == 900
