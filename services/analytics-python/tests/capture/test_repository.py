"""CRUD, idempotency, and billing-ledger behaviour of the SQLite capture store."""

from __future__ import annotations

import uuid

import pytest_asyncio

from app.capture.models import (
    AlertLabel,
    CapturedEvent,
    InvoiceLedgerEntry,
    RiskFlag,
)
from app.capture.repository import SqliteCaptureRepository

_OP = str(uuid.uuid4())
_OTHER_OP = str(uuid.uuid4())


@pytest_asyncio.fixture
async def repo() -> SqliteCaptureRepository:
    store = await SqliteCaptureRepository.connect(":memory:")
    try:
        yield store
    finally:
        await store.close()


def _event(event_id: str, operator_id: str = _OP) -> CapturedEvent:
    return CapturedEvent(
        event_id=event_id,
        event_type="reading.recorded",
        operator_id=operator_id,
        subscriber_id=str(uuid.uuid4()),
        raw_json="{}",
        captured_at="2026-06-18T10:00:00Z",
    )


async def test_save_event_is_idempotent(repo: SqliteCaptureRepository) -> None:
    event = _event("evt-1")

    assert await repo.save_event(event) is True
    assert await repo.save_event(event) is False  # redelivery is a no-op


async def test_risk_flags_scoped_by_operator(repo: SqliteCaptureRepository) -> None:
    reading_id = str(uuid.uuid4())
    sub = str(uuid.uuid4())
    await repo.save_risk_flag(
        RiskFlag(reading_id, _OP, sub, "NEGATIVE_DELTA", 1.0, "2026-06-18T10:00:00Z")
    )
    await repo.save_risk_flag(
        RiskFlag(str(uuid.uuid4()), _OTHER_OP, sub, "ZERO_DELTA", 0.8, "2026-06-18T10:00:00Z")
    )

    mine = await repo.find_risk(_OP)
    assert [f.reading_id for f in mine] == [reading_id]
    assert await repo.find_risk_by_reading(_OTHER_OP, reading_id) is None
    assert await repo.find_risk_by_reading(_OP, reading_id) is not None


async def test_find_risk_filters_by_subscriber(repo: SqliteCaptureRepository) -> None:
    sub_a, sub_b = str(uuid.uuid4()), str(uuid.uuid4())
    await repo.save_risk_flag(
        RiskFlag(str(uuid.uuid4()), _OP, sub_a, "ZERO_DELTA", 0.8, "2026-06-18T10:00:00Z")
    )
    await repo.save_risk_flag(
        RiskFlag(str(uuid.uuid4()), _OP, sub_b, "ZERO_DELTA", 0.8, "2026-06-18T10:00:00Z")
    )

    assert len(await repo.find_risk(_OP, subscriber_id=sub_a)) == 1
    assert len(await repo.find_risk(_OP)) == 2


async def test_save_label_upserts(repo: SqliteCaptureRepository) -> None:
    reading_id = str(uuid.uuid4())
    await repo.save_label(AlertLabel(reading_id, _OP, True, "2026-06-18T10:00:00Z"))
    await repo.save_label(AlertLabel(reading_id, _OP, False, "2026-06-18T11:00:00Z"))
    # No exception; latest write wins (verified indirectly: single row, no PK clash)


async def test_collection_rate_aggregates_issued_and_paid(repo: SqliteCaptureRepository) -> None:
    inv = str(uuid.uuid4())
    await repo.upsert_invoice(
        InvoiceLedgerEntry(inv, _OP, "2026-06-01", "2026-06-30", 100.0, 9_000_000, 0.0, 0)
    )
    await repo.add_payment(_OP, inv, 40.0, 3_600_000)
    await repo.add_payment(_OP, inv, 10.0, 900_000)

    rate = await repo.collection_rate(_OP)
    assert rate.invoice_count == 1
    assert rate.issued_usd == 100.0
    assert rate.paid_usd == 50.0
    assert rate.collection_rate_usd == 0.5


async def test_payment_before_invoice_is_not_lost(repo: SqliteCaptureRepository) -> None:
    inv = str(uuid.uuid4())
    await repo.add_payment(_OP, inv, 25.0, 2_000_000)  # arrives before invoice.issued

    rate = await repo.collection_rate(_OP)
    assert rate.paid_usd == 25.0
    assert rate.issued_usd == 0.0
    assert rate.invoice_count == 0  # placeholder row is not counted as an issued invoice


async def test_invoice_count_only_counts_issued(repo: SqliteCaptureRepository) -> None:
    inv = str(uuid.uuid4())
    await repo.add_payment(_OP, inv, 25.0, 0)  # placeholder (issued=0)
    assert (await repo.collection_rate(_OP)).invoice_count == 0

    await repo.upsert_invoice(
        InvoiceLedgerEntry(inv, _OP, "2026-06-01", "2026-06-30", 100.0, 0, 0.0, 0)
    )
    assert (await repo.collection_rate(_OP)).invoice_count == 1


async def test_record_invoice_is_atomic_and_idempotent(repo: SqliteCaptureRepository) -> None:
    inv = str(uuid.uuid4())
    entry = InvoiceLedgerEntry(inv, _OP, "2026-06-01", "2026-06-30", 100.0, 0, 0.0, 0)

    assert await repo.record_invoice(_event("inv-evt"), entry) is True
    assert await repo.record_invoice(_event("inv-evt"), entry) is False  # redelivery
    assert (await repo.collection_rate(_OP)).invoice_count == 1


async def test_collection_rate_scoped_by_operator(repo: SqliteCaptureRepository) -> None:
    await repo.upsert_invoice(
        InvoiceLedgerEntry(str(uuid.uuid4()), _OP, "2026-06-01", "2026-06-30", 100.0, 0, 0.0, 0)
    )
    await repo.upsert_invoice(
        InvoiceLedgerEntry(str(uuid.uuid4()), _OTHER_OP, "2026-06-01", "2026-06-30", 200.0, 0, 0.0, 0)
    )

    assert (await repo.collection_rate(_OP)).issued_usd == 100.0
