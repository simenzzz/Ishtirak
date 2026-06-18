"""Feature extraction, including cold-start and boundary handling."""

from __future__ import annotations

import pytest

from app.redis_state.subscriber_state import SubscriberState
from app.redis_state.tier_cache import TierInfo
from app.rules.features import extract

_T0 = "2026-06-18T10:00:00Z"
_T1 = "2026-06-18T11:00:00Z"  # one hour later


def test_cold_start_yields_all_none() -> None:
    features = extract(100.0, _T0, state=None, tier_info=None)

    assert features.delta is None
    assert features.drop_pct is None
    assert features.tier_max_kwh is None
    assert features.elapsed_hours is None


def test_delta_and_elapsed_hours() -> None:
    state = SubscriberState(100.0, _T0, ())
    features = extract(110.0, _T1, state=state, tier_info=None)

    assert features.delta == 10.0
    assert features.elapsed_hours == pytest.approx(1.0)


def test_drop_pct_against_trailing_average() -> None:
    state = SubscriberState(100.0, _T0, (10.0, 10.0))  # avg 10
    features = extract(104.0, _T1, state=state, tier_info=None)  # delta 4 → 60% drop

    assert features.drop_pct == pytest.approx(0.6)


def test_drop_pct_none_without_history() -> None:
    state = SubscriberState(100.0, _T0, ())
    assert extract(104.0, _T1, state=state, tier_info=None).drop_pct is None


def test_tier_max_kwh_formula() -> None:
    state = SubscriberState(100.0, _T0, ())
    # 5 A * 220 V * 1 h / 1000 = 1.1 kWh
    features = extract(101.0, _T1, state=state, tier_info=TierInfo(amperage=5))

    assert features.tier_max_kwh == pytest.approx(1.1)


def test_non_positive_elapsed_hours_blocks_tier_cap() -> None:
    state = SubscriberState(100.0, _T1, ())  # previous reading is later than current
    features = extract(101.0, _T0, state=state, tier_info=TierInfo(amperage=5))

    assert features.elapsed_hours is None
    assert features.tier_max_kwh is None
