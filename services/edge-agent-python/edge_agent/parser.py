"""Parse Tasmota ``tele/<meter>/SENSOR`` telemetry into a :class:`Reading`."""

from __future__ import annotations

import json
from datetime import datetime

from .reading import Reading


class TelemetryError(ValueError):
    """Raised when a telemetry message is malformed and cannot yield a reading."""


def meter_id_from_topic(topic: str) -> str:
    """Extract ``<meter>`` from ``tele/<meter>/SENSOR`` (the Tasmota Topic == meter serial)."""
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != "tele" or parts[2] != "SENSOR" or not parts[1]:
        raise TelemetryError(f"unexpected telemetry topic: {topic!r}")
    return parts[1]


def parse_sensor(topic: str, payload: bytes | str, captured_at: datetime) -> Reading:
    """
    Build a reading from a SENSOR message. The cumulative register is
    ``ENERGY.Total``; ``captured_at`` (the agent's receive time) is used as the
    reading instant to avoid the timezone ambiguity of Tasmota's local ``Time``.
    """
    meter_id = meter_id_from_topic(topic)
    try:
        document = json.loads(payload)
    except (json.JSONDecodeError, TypeError) as exc:
        raise TelemetryError(f"telemetry for {meter_id} is not valid JSON") from exc

    energy = document.get("ENERGY") if isinstance(document, dict) else None
    if not isinstance(energy, dict) or "Total" not in energy:
        raise TelemetryError(f"telemetry for {meter_id} has no ENERGY.Total")

    try:
        kwh = float(energy["Total"])
    except (TypeError, ValueError) as exc:
        raise TelemetryError(f"telemetry for {meter_id} has non-numeric ENERGY.Total") from exc
    if kwh < 0:
        raise TelemetryError(f"telemetry for {meter_id} has negative ENERGY.Total")

    return Reading(meter_id=meter_id, kwh=kwh, reading_at=captured_at)
