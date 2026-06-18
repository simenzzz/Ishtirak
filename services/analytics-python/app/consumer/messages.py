"""Pydantic models validating inbound event envelopes at the consumer boundary.

``extra="forbid"`` mirrors ``additionalProperties: false`` in the JSON Schemas, and
the ``Literal`` event types reject mis-routed messages.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

_STRICT = ConfigDict(populate_by_name=True, extra="forbid")


class _Envelope(BaseModel):
    model_config = _STRICT

    event_id: UUID = Field(alias="eventId")
    operator_id: UUID = Field(alias="operatorId")
    occurred_at: datetime = Field(alias="occurredAt")


class ReadingRecordedPayload(BaseModel):
    model_config = _STRICT

    reading_id: UUID = Field(alias="readingId")
    subscriber_id: UUID = Field(alias="subscriberId")
    kwh: float = Field(ge=0)
    reading_at: datetime = Field(alias="readingAt")


class ReadingRecordedEvent(_Envelope):
    event_type: Literal["reading.recorded"] = Field(alias="eventType")
    payload: ReadingRecordedPayload


class InvoiceIssuedPayload(BaseModel):
    model_config = _STRICT

    invoice_id: UUID = Field(alias="invoiceId")
    subscriber_id: UUID = Field(alias="subscriberId")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")
    amount_usd: float = Field(alias="amountUsd", ge=0)
    amount_lbp: int = Field(alias="amountLbp", ge=0)
    kwh_consumed: float = Field(alias="kwhConsumed", ge=0)


class InvoiceIssuedEvent(_Envelope):
    event_type: Literal["invoice.issued"] = Field(alias="eventType")
    payload: InvoiceIssuedPayload


class PaymentReceivedPayload(BaseModel):
    model_config = _STRICT

    payment_id: UUID = Field(alias="paymentId")
    invoice_id: UUID = Field(alias="invoiceId")
    subscriber_id: UUID = Field(alias="subscriberId")
    currency: Literal["USD", "LBP"]
    tendered_amount: float = Field(alias="tenderedAmount", ge=0)
    applied_usd: float = Field(alias="appliedUsd", ge=0)
    applied_lbp: int = Field(alias="appliedLbp", ge=0)
    method: Literal["CASH", "WHISH"]


class PaymentReceivedEvent(_Envelope):
    event_type: Literal["payment.received"] = Field(alias="eventType")
    payload: PaymentReceivedPayload
