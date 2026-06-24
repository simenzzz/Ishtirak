"""Environment-driven configuration for the edge agent."""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    """Raised at startup when required configuration is missing."""


@dataclass(frozen=True)
class Config:
    gateway_url: str
    device_token: str
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_topic: str = "tele/+/SENSOR"
    command_prefix: str = "cmnd"
    buffer_path: str = "edge-buffer.sqlite3"
    batch_size: int = 200
    flush_interval_secs: float = 30.0


def load_config(environ: dict[str, str] | None = None) -> Config:
    env = environ if environ is not None else dict(os.environ)
    gateway_url = env.get("GATEWAY_URL", "").strip()
    device_token = env.get("DEVICE_TOKEN", "").strip()
    missing = [
        name
        for name, value in (("GATEWAY_URL", gateway_url), ("DEVICE_TOKEN", device_token))
        if not value
    ]
    if missing:
        raise ConfigError(f"missing required environment variables: {', '.join(missing)}")

    return Config(
        gateway_url=gateway_url,
        device_token=device_token,
        mqtt_host=env.get("MQTT_HOST", "localhost"),
        mqtt_port=_int(env, "MQTT_PORT", 1883),
        mqtt_topic=env.get("MQTT_TOPIC", "tele/+/SENSOR"),
        command_prefix=env.get("COMMAND_PREFIX", "cmnd"),
        buffer_path=env.get("BUFFER_PATH", "edge-buffer.sqlite3"),
        batch_size=_int(env, "BATCH_SIZE", 200),
        flush_interval_secs=_float(env, "FLUSH_INTERVAL_SECS", 30.0),
    )


def _int(env: dict[str, str], name: str, default: int) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


def _float(env: dict[str, str], name: str, default: float) -> float:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from exc
