"""UTC timestamp helper shared across the service."""

from __future__ import annotations

from datetime import datetime, timezone


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string with a ``Z`` suffix."""

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
