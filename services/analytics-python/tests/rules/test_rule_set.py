"""Boundary behaviour of each individual rule."""

from __future__ import annotations

import pytest

from app.rules.features import FeatureVector
from app.rules import rule_set


def _features(
    delta: float | None = None,
    drop_pct: float | None = None,
    tier_max_kwh: float | None = None,
) -> FeatureVector:
    return FeatureVector(
        delta=delta, drop_pct=drop_pct, tier_max_kwh=tier_max_kwh, elapsed_hours=1.0
    )


@pytest.mark.parametrize("delta,fires", [(-0.1, True), (0.0, False), (5.0, False), (None, False)])
def test_negative_delta(delta: float | None, fires: bool) -> None:
    result = rule_set.check_negative_delta(_features(delta=delta))
    assert (result is not None) == fires
    if fires:
        assert result.reason == rule_set.NEGATIVE_DELTA
        assert result.score == 1.0


@pytest.mark.parametrize("delta,fires", [(0.0, True), (0.01, False), (-1.0, False), (None, False)])
def test_zero_delta(delta: float | None, fires: bool) -> None:
    result = rule_set.check_zero_delta(_features(delta=delta))
    assert (result is not None) == fires


@pytest.mark.parametrize(
    "drop_pct,fires", [(0.41, True), (0.4, False), (0.39, False), (None, False)]
)
def test_drop_gt_threshold(drop_pct: float | None, fires: bool) -> None:
    result = rule_set.check_drop_gt_threshold(_features(drop_pct=drop_pct), threshold_pct=0.4)
    assert (result is not None) == fires


@pytest.mark.parametrize(
    "delta,tier_max,fires",
    [(1.2, 1.1, True), (1.1, 1.1, False), (1.0, 1.1, False), (None, 1.1, False), (1.2, None, False)],
)
def test_exceeds_tier_cap(
    delta: float | None, tier_max: float | None, fires: bool
) -> None:
    result = rule_set.check_exceeds_tier_cap(_features(delta=delta, tier_max_kwh=tier_max))
    assert (result is not None) == fires
