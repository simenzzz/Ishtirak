"""Emitted reading.flagged events validate against the source-of-truth schema."""

from __future__ import annotations

import uuid

import pytest
from jsonschema import ValidationError

from app.publisher.reading_flagged import build_reading_flagged
from app.publisher.schema import load_validator
from app.rules import rule_set

_OP = str(uuid.uuid4())
_READING = str(uuid.uuid4())
_SUB = str(uuid.uuid4())


def test_built_event_is_contract_valid() -> None:
    validator = load_validator("reading-flagged.schema.json")
    event = build_reading_flagged(_OP, _READING, _SUB, rule_set.NEGATIVE_DELTA, 1.0)

    validator.validate(event)  # raises if invalid

    assert event["eventType"] == "reading.flagged"
    assert event["occurredAt"].endswith("Z")


@pytest.mark.parametrize("reason", sorted(rule_set.SCORES))
def test_all_rule_reasons_are_valid_enum_values(reason: str) -> None:
    validator = load_validator("reading-flagged.schema.json")
    event = build_reading_flagged(_OP, _READING, _SUB, reason, rule_set.SCORES[reason])

    validator.validate(event)


def test_invalid_event_is_rejected() -> None:
    validator = load_validator("reading-flagged.schema.json")
    event = build_reading_flagged(_OP, _READING, _SUB, "NOT_A_REASON", 5.0)

    with pytest.raises(ValidationError):
        validator.validate(event)
