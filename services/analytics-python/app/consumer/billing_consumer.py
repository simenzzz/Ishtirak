"""Consume ``invoice.issued`` and ``payment.received`` into the collection-rate ledger.

The capture write is the idempotency gate, so a redelivered billing event never
double-counts issued or paid amounts.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import aio_pika
from pydantic import ValidationError

from app.capture.models import CapturedEvent, InvoiceLedgerEntry
from app.capture.repository import CaptureRepository
from app.clock import now_iso
from app.config import INVOICE_ISSUED_KEY, PAYMENT_RECEIVED_KEY
from app.consumer.messages import InvoiceIssuedEvent, PaymentReceivedEvent

logger = logging.getLogger(__name__)


@dataclass
class BillingPipeline:
    capture_repo: CaptureRepository

    async def process_invoice(self, event: InvoiceIssuedEvent, raw_json: str) -> None:
        payload = event.payload
        entry = InvoiceLedgerEntry(
            invoice_id=str(payload.invoice_id),
            operator_id=str(event.operator_id),
            period_start=payload.period_start.isoformat(),
            period_end=payload.period_end.isoformat(),
            amount_usd=payload.amount_usd,
            amount_lbp=payload.amount_lbp,
            paid_usd=0.0,
            paid_lbp=0,
        )
        # Capture + ledger update commit atomically, so a redelivery after a partial
        # failure replays cleanly rather than leaving the ledger un-updated.
        if not await self.capture_repo.record_invoice(self._captured(event, raw_json), entry):
            logger.info("billing event %s already processed; skipping", event.event_id)

    async def process_payment(self, event: PaymentReceivedEvent, raw_json: str) -> None:
        is_new = await self.capture_repo.record_payment(
            self._captured(event, raw_json),
            invoice_id=str(event.payload.invoice_id),
            applied_usd=event.payload.applied_usd,
            applied_lbp=event.payload.applied_lbp,
        )
        if not is_new:
            logger.info("billing event %s already processed; skipping", event.event_id)

    @staticmethod
    def _captured(event: InvoiceIssuedEvent | PaymentReceivedEvent, raw_json: str) -> CapturedEvent:
        return CapturedEvent(
            event_id=str(event.event_id),
            event_type=event.event_type,
            operator_id=str(event.operator_id),
            subscriber_id=str(event.payload.subscriber_id),
            raw_json=raw_json,
            captured_at=now_iso(),
        )


def make_billing_handler(pipeline: BillingPipeline):
    async def handler(message: aio_pika.abc.AbstractIncomingMessage) -> None:
        async with message.process(requeue=False):
            raw = message.body.decode("utf-8")
            try:
                data = json.loads(raw)
                event_type = data.get("eventType")
                if event_type == INVOICE_ISSUED_KEY:
                    await pipeline.process_invoice(InvoiceIssuedEvent.model_validate(data), raw)
                elif event_type == PAYMENT_RECEIVED_KEY:
                    await pipeline.process_payment(PaymentReceivedEvent.model_validate(data), raw)
                else:
                    logger.critical("dropping billing message with unknown type %r", event_type)
            except (ValidationError, json.JSONDecodeError) as exc:
                logger.critical("dropping poison billing message: %s", exc)

    return handler
