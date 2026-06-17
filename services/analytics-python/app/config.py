"""Validated runtime configuration, read once at startup from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


@dataclass(frozen=True)
class Settings:
    """Immutable application settings. Built via :func:`load_settings`."""

    rabbitmq_url: str
    redis_url: str
    exchange: str = "ishtirak.events"
    queue: str = "analytics.reading-recorded"

    @property
    def routing_keys(self) -> tuple[str, ...]:
        return ("reading.recorded",)


def load_settings(env: dict[str, str] | None = None) -> Settings:
    """Build settings from ``env`` (defaults to ``os.environ``).

    Fails fast with a clear message when a required variable is absent so the
    container crashes at boot rather than at first request.
    """

    source = env if env is not None else dict(os.environ)
    try:
        return Settings(
            rabbitmq_url=_required(source, "ISHTIRAK_RABBITMQ_URL"),
            redis_url=_required(source, "ISHTIRAK_REDIS_URL"),
        )
    except KeyError as exc:  # pragma: no cover - defensive
        raise ConfigError(str(exc)) from exc


def _required(source: dict[str, str], key: str) -> str:
    value = source.get(key, "").strip()
    if not value:
        raise ConfigError(f"missing required environment variable: {key}")
    return value
