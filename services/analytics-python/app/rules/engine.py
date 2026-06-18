"""Rule engine: apply rules in priority order and return the first match."""

from __future__ import annotations

from app.config import Settings
from app.rules.features import FeatureVector
from app.rules.rule_set import (
    RuleResult,
    check_drop_gt_threshold,
    check_exceeds_tier_cap,
    check_negative_delta,
    check_zero_delta,
)


def apply_rules(features: FeatureVector, settings: Settings) -> RuleResult | None:
    """Return the highest-priority rule that fires, or ``None`` if the reading is clean.

    Priority is by descending score: NEGATIVE_DELTA, ZERO_DELTA, EXCEEDS_TIER_CAP,
    DROP_GT_THRESHOLD. First match wins.
    """

    return (
        check_negative_delta(features)
        or check_zero_delta(features)
        or check_exceeds_tier_cap(features)
        or check_drop_gt_threshold(features, settings.drop_threshold_pct)
    )
