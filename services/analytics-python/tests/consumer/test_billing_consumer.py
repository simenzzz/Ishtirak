"""Billing pipeline: collection-rate ledger updates and idempotent redelivery."""

from __future__ import annotations

import uuid

import pytest_asyncio

from app.capture.repository import SqliteCaptureRepository
from app.consumer.billing_consumer import BillingPipeline
from app.consumer.messages import InvoiceIssuedEvent, PaymentReceivedEvent

_OP = str(uuid.uuid4())
_SUB = str(uuid.uuid4())
_INV = str(uuid.uuid4())


@pytest_asyncio.fixture
async def repo():
    store = await SqliteCaptureRepository.connect(":memory:")
    try:
        yield store
    finally:
        await store.close()


def _invoice(event_id: str | None = None) -> InvoiceIssuedEvent:
    return InvoiceIssuedEvent.model_validate(
        {
            "eventId": event_id or str(uuid.uuid4()),
            "eventType": "invoice.issued",
            "operatorId": _OP,
            "occurredAt": "2026-06-18T10:00:00Z",
            "payload": {
                "invoiceId": _INV,
                "subscriberId": _SUB,
                "periodStart": "2026-06-01",
                "periodEnd": "2026-06-30",
                "amountUsd": 100.0,
                "amountLbp": 9_000_000,
                "kwhConsumed": 250.0,
            },
        }
    )


def _payment(applied_usd: float, event_id: str | None = None) -> PaymentReceivedEvent:
    return PaymentReceivedEvent.model_validate(
        {
            "eventId": event_id or str(uuid.uuid4()),
            "eventType": "payment.received",
            "operatorId": _OP,
            "occurredAt": "2026-06-18T12:00:00Z",
            "payload": {
                "paymentId": str(uuid.uuid4()),
                "invoiceId": _INV,
                "subscriberId": _SUB,
                "currency": "USD",
                "tenderedAmount": applied_usd,
                "appliedUsd": applied_usd,
                "appliedLbp": 0,
                "method": "CASH",
            },
        }
    )


async def test_invoice_and_payment_update_collection_rate(repo) -> None:
    pipeline = BillingPipeline(repo)
    invoice = _invoice()
    await pipeline.process_invoice(invoice, invoice.model_dump_json())
    payment = _payment(40.0)
    await pipeline.process_payment(payment, payment.model_dump_json())

    rate = await repo.collection_rate(_OP)
    assert rate.issued_usd == 100.0
    assert rate.paid_usd == 40.0


async def test_redelivered_payment_not_double_counted(repo) -> None:
    pipeline = BillingPipeline(repo)
    invoice = _invoice()
    await pipeline.process_invoice(invoice, invoice.model_dump_json())
    payment = _payment(40.0)
    await pipeline.process_payment(payment, payment.model_dump_json())
    await pipeline.process_payment(payment, payment.model_dump_json())  # redelivery

    assert (await repo.collection_rate(_OP)).paid_usd == 40.0
