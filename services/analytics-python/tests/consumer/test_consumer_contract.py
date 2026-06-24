"""Inbound consumer models stay in sync with the source-of-truth event schemas.

Each consumed event has a hand-written Pydantic model in ``app.consumer.messages``
that re-implements the matching ``contracts/events/*.schema.json``. Nothing else
asserts the two stay aligned, so these tests bridge them: a fixture is first proven
valid against the JSON Schema, then fed through the consumer model. Drift in either
direction (renamed/added/removed field, changed enum) fails the build.
"""

from __future__ import annotations

import copy
from collections.abc import Iterator
from typing import Any, Callable

import pytest
from pydantic import BaseModel, ValidationError

from app.consumer.messages import (
    InvoiceIssuedEvent,
    PaymentReceivedEvent,
    ReadingRecordedEvent,
)
from app.publisher.schema import load_validator

_OP = "11111111-1111-1111-1111-111111111111"
_SUB = "22222222-2222-2222-2222-222222222222"
_EVENT = "33333333-3333-3333-3333-333333333333"


def _envelope(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "eventId": _EVENT,
        "eventType": event_type,
        "operatorId": _OP,
        "occurredAt": "2026-06-18T10:00:00Z",
        "payload": payload,
    }


def _reading_recorded() -> dict[str, Any]:
    return _envelope(
        "reading.recorded",
        {
            "readingId": "44444444-4444-4444-4444-444444444444",
            "subscriberId": _SUB,
            "kwh": 1234.5,
            "readingAt": "2026-06-18T09:55:00Z",
        },
    )


def _invoice_issued() -> dict[str, Any]:
    return _envelope(
        "invoice.issued",
        {
            "invoiceId": "55555555-5555-5555-5555-555555555555",
            "subscriberId": _SUB,
            "periodStart": "2026-06-01",
            "periodEnd": "2026-06-30",
            "amountUsd": 100.0,
            "amountLbp": 9000000,
            "kwhConsumed": 20.0,
        },
    )


def _payment_received() -> dict[str, Any]:
    return _envelope(
        "payment.received",
        {
            "paymentId": "66666666-6666-6666-6666-666666666666",
            "invoiceId": "55555555-5555-5555-5555-555555555555",
            "subscriberId": _SUB,
            "currency": "USD",
            "tenderedAmount": 100.0,
            "appliedUsd": 100.0,
            "appliedLbp": 0,
            "method": "CASH",
        },
    )


# (schema file, consumer model, fixture factory)
_CASES: list[tuple[str, type[BaseModel], Callable[[], dict[str, Any]]]] = [
    ("reading-recorded.schema.json", ReadingRecordedEvent, _reading_recorded),
    ("invoice-issued.schema.json", InvoiceIssuedEvent, _invoice_issued),
    ("payment-received.schema.json", PaymentReceivedEvent, _payment_received),
]


@pytest.mark.parametrize(
    "schema_name, model, factory", _CASES, ids=[c[0] for c in _CASES]
)
def test_consumer_accepts_contract_valid_event(
    schema_name: str, model: type[BaseModel], factory: Callable[[], dict[str, Any]]
) -> None:
    event = factory()

    load_validator(schema_name).validate(event)  # schema side: keeps the fixture honest
    parsed = model.model_validate(event)  # consumer side: must accept what the schema accepts

    assert str(parsed.event_id) == event["eventId"]  # type: ignore[attr-defined]
    assert parsed.event_type == event["eventType"]  # type: ignore[attr-defined]


def _required_removals(
    schema: dict[str, Any], event: dict[str, Any]
) -> Iterator[tuple[str, dict[str, Any]]]:
    for key in schema["required"]:
        mutated = copy.deepcopy(event)
        mutated.pop(key, None)
        yield key, mutated
    for key in schema["properties"]["payload"]["required"]:
        mutated = copy.deepcopy(event)
        mutated["payload"].pop(key, None)
        yield f"payload.{key}", mutated


def _removal_params() -> list[Any]:
    params: list[Any] = []
    for schema_name, model, factory in _CASES:
        schema = load_validator(schema_name).schema
        for label, mutated in _required_removals(schema, factory()):
            params.append(pytest.param(model, mutated, id=f"{schema_name}::missing-{label}"))
    return params


@pytest.mark.parametrize("model, mutated", _removal_params())
def test_consumer_rejects_event_missing_required_field(
    model: type[BaseModel], mutated: dict[str, Any]
) -> None:
    """A field the contract marks required must also be required by the consumer."""

    with pytest.raises(ValidationError):
        model.model_validate(mutated)
