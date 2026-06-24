"""Immutable value type for a captured meter reading."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone


def _iso_utc(moment: datetime) -> str:
    """Render an instant as RFC3339 UTC with a trailing Z (what the ingest API accepts)."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


@dataclass(frozen=True)
class Reading:
    """A single cumulative meter reading, ready to buffer and upload."""

    meter_id: str
    kwh: float
    reading_at: datetime

    @property
    def reading_at_iso(self) -> str:
        return _iso_utc(self.reading_at)

    @property
    def idempotency_key(self) -> str:
        """Stable per (meter, instant) so a retried upload is recognised as the same point."""
        return hashlib.sha256(f"{self.meter_id}|{self.reading_at_iso}".encode()).hexdigest()

    def to_payload(self) -> dict[str, object]:
        return {"meterId": self.meter_id, "kwh": self.kwh, "readingAt": self.reading_at_iso}
