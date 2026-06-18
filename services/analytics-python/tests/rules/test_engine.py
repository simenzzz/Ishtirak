"""Engine priority and first-match semantics."""

from __future__ import annotations

from app.rules.engine import apply_rules
from app.rules.features import FeatureVector
from app.rules import rule_set
from tests.conftest import make_settings

_SETTINGS = make_settings(drop_threshold_pct=0.4)


def _f(delta=None, drop_pct=None, tier_max_kwh=None) -> FeatureVector:
    return FeatureVector(delta=delta, drop_pct=drop_pct, tier_max_kwh=tier_max_kwh, elapsed_hours=1.0)


def test_clean_reading_returns_none() -> None:
    assert apply_rules(_f(delta=5.0, drop_pct=0.0, tier_max_kwh=100.0), _SETTINGS) is None


def test_negative_delta_wins_over_drop() -> None:
    # negative delta also looks like a large drop; highest priority must win
    result = apply_rules(_f(delta=-1.0, drop_pct=2.0, tier_max_kwh=100.0), _SETTINGS)
    assert result.reason == rule_set.NEGATIVE_DELTA


def test_tier_cap_wins_over_drop() -> None:
    result = apply_rules(_f(delta=50.0, drop_pct=0.9, tier_max_kwh=1.1), _SETTINGS)
    assert result.reason == rule_set.EXCEEDS_TIER_CAP


def test_drop_fires_when_no_higher_rule() -> None:
    result = apply_rules(_f(delta=4.0, drop_pct=0.6, tier_max_kwh=100.0), _SETTINGS)
    assert result.reason == rule_set.DROP_GT_THRESHOLD
