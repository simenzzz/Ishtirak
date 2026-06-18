"""Feature extraction: turn a reading + rolling state + tier into a feature vector.

Pure and side-effect free. Every feature is ``None`` when it cannot be computed
(cold start, no trailing history, unknown tier) so rules can opt out cleanly.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.redis_state.subscriber_state import SubscriberState
from app.redis_state.tier_cache import TierInfo

_VOLTAGE = 220  # nominal single-phase volts; amps * volts * hours / 1000 = kWh cap


@dataclass(frozen=True)
class FeatureVector:
    delta: float | None
    drop_pct: float | None
    tier_max_kwh: float | None
    elapsed_hours: float | None


def extract(
    current_kwh: float,
    reading_at: str,
    state: SubscriberState | None,
    tier_info: TierInfo | None,
) -> FeatureVector:
    if state is None:
        return FeatureVector(delta=None, drop_pct=None, tier_max_kwh=None, elapsed_hours=None)

    delta = current_kwh - state.previous_kwh
    elapsed_hours = _elapsed_hours(state.previous_reading_at, reading_at)
    return FeatureVector(
        delta=delta,
        drop_pct=_drop_pct(delta, state.trailing_deltas),
        tier_max_kwh=_tier_max_kwh(tier_info, elapsed_hours),
        elapsed_hours=elapsed_hours,
    )


def _drop_pct(delta: float, trailing_deltas: tuple[float, ...]) -> float | None:
    if not trailing_deltas:
        return None
    average = sum(trailing_deltas) / len(trailing_deltas)
    if average <= 0:
        return None
    return (average - delta) / average


def _tier_max_kwh(tier_info: TierInfo | None, elapsed_hours: float | None) -> float | None:
    if tier_info is None or elapsed_hours is None:
        return None
    return tier_info.amperage * _VOLTAGE * elapsed_hours / 1000


def _elapsed_hours(previous_reading_at: str, reading_at: str) -> float | None:
    try:
        start = _parse(previous_reading_at)
        end = _parse(reading_at)
    except ValueError:
        return None
    hours = (end - start).total_seconds() / 3600
    return hours if hours > 0 else None


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
