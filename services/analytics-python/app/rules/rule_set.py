"""Individual detection rules. Each is a pure predicate over a feature vector.

Reason codes must match ``contracts/events/reading-flagged.schema.json``.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.rules.features import FeatureVector

NEGATIVE_DELTA = "NEGATIVE_DELTA"
ZERO_DELTA = "ZERO_DELTA"
DROP_GT_THRESHOLD = "DROP_GT_THRESHOLD"
EXCEEDS_TIER_CAP = "EXCEEDS_TIER_CAP"

SCORES: dict[str, float] = {
    NEGATIVE_DELTA: 1.0,
    ZERO_DELTA: 0.8,
    EXCEEDS_TIER_CAP: 0.75,
    DROP_GT_THRESHOLD: 0.65,
}


@dataclass(frozen=True)
class RuleResult:
    reason: str
    score: float


def check_negative_delta(features: FeatureVector) -> RuleResult | None:
    if features.delta is not None and features.delta < 0:
        return RuleResult(NEGATIVE_DELTA, SCORES[NEGATIVE_DELTA])
    return None


def check_zero_delta(features: FeatureVector) -> RuleResult | None:
    if features.delta is not None and features.delta == 0:
        return RuleResult(ZERO_DELTA, SCORES[ZERO_DELTA])
    return None


def check_exceeds_tier_cap(features: FeatureVector) -> RuleResult | None:
    if (
        features.delta is not None
        and features.tier_max_kwh is not None
        and features.delta > features.tier_max_kwh
    ):
        return RuleResult(EXCEEDS_TIER_CAP, SCORES[EXCEEDS_TIER_CAP])
    return None


def check_drop_gt_threshold(features: FeatureVector, threshold_pct: float) -> RuleResult | None:
    if features.drop_pct is not None and features.drop_pct > threshold_pct:
        return RuleResult(DROP_GT_THRESHOLD, SCORES[DROP_GT_THRESHOLD])
    return None
