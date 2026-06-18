"""Immutable records persisted by the capture store (ADR-007)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CapturedEvent:
    """A raw consumed event, recorded for the post-v1 retraining loop."""

    event_id: str
    event_type: str
    operator_id: str
    subscriber_id: str | None
    raw_json: str
    captured_at: str


@dataclass(frozen=True)
class RiskFlag:
    """A scored tampering signal for a single reading."""

    reading_id: str
    operator_id: str
    subscriber_id: str
    reason: str
    score: float
    flagged_at: str


@dataclass(frozen=True)
class AlertLabel:
    """An operator confirm/dismiss decision on a flagged reading."""

    reading_id: str
    operator_id: str
    confirmed: bool
    labeled_at: str


@dataclass(frozen=True)
class InvoiceLedgerEntry:
    """Per-invoice issued-vs-paid amounts backing the collection-rate summary.

    Keyed by ``invoice_id`` because ``payment.received`` carries no billing period;
    payments are attributed to a period via the invoice they reference.
    """

    invoice_id: str
    operator_id: str
    period_start: str
    period_end: str
    amount_usd: float
    amount_lbp: int
    paid_usd: float
    paid_lbp: int


@dataclass(frozen=True)
class CollectionRate:
    """Aggregated paid-vs-issued summary for one operator."""

    operator_id: str
    invoice_count: int
    issued_usd: float
    issued_lbp: int
    paid_usd: float
    paid_lbp: int

    @property
    def collection_rate_usd(self) -> float:
        return round(self.paid_usd / self.issued_usd, 4) if self.issued_usd else 0.0

    @property
    def collection_rate_lbp(self) -> float:
        return round(self.paid_lbp / self.issued_lbp, 4) if self.issued_lbp else 0.0
