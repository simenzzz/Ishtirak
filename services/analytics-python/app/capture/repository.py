"""Capture-store repository: an abstract port plus a SQLite (WAL) adapter."""

from __future__ import annotations

from abc import ABC, abstractmethod

import aiosqlite

from app.capture.models import (
    AlertLabel,
    CapturedEvent,
    CollectionRate,
    InvoiceLedgerEntry,
    RiskFlag,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS captured_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    subscriber_id TEXT,
    raw_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_flags (
    reading_id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    subscriber_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    score REAL NOT NULL,
    flagged_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_flags_operator ON risk_flags (operator_id);
CREATE TABLE IF NOT EXISTS alert_labels (
    reading_id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    confirmed INTEGER NOT NULL,
    labeled_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_ledger (
    invoice_id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    issued INTEGER NOT NULL DEFAULT 0,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    amount_lbp INTEGER NOT NULL,
    paid_usd REAL NOT NULL DEFAULT 0,
    paid_lbp INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_ledger_operator ON invoice_ledger (operator_id);
"""


class CaptureRepository(ABC):
    """Storage port for consumed events, risk flags, labels, and billing ledger."""

    @abstractmethod
    async def save_event(self, event: CapturedEvent) -> bool:
        """Persist a consumed event; return ``True`` only if it was newly inserted."""

    @abstractmethod
    async def save_risk_flag(self, flag: RiskFlag) -> None: ...

    @abstractmethod
    async def find_risk(self, operator_id: str, subscriber_id: str | None = None) -> list[RiskFlag]: ...

    @abstractmethod
    async def find_risk_by_reading(self, operator_id: str, reading_id: str) -> RiskFlag | None: ...

    @abstractmethod
    async def save_label(self, label: AlertLabel) -> None: ...

    @abstractmethod
    async def upsert_invoice(self, entry: InvoiceLedgerEntry) -> None: ...

    @abstractmethod
    async def add_payment(
        self, operator_id: str, invoice_id: str, applied_usd: float, applied_lbp: int
    ) -> None: ...

    @abstractmethod
    async def record_invoice(self, event: CapturedEvent, entry: InvoiceLedgerEntry) -> bool:
        """Atomically capture an invoice event and update the ledger; ``True`` if new."""

    @abstractmethod
    async def record_payment(
        self, event: CapturedEvent, invoice_id: str, applied_usd: float, applied_lbp: int
    ) -> bool:
        """Atomically capture a payment event and update the ledger; ``True`` if new."""

    @abstractmethod
    async def collection_rate(self, operator_id: str) -> CollectionRate: ...


class SqliteCaptureRepository(CaptureRepository):
    """SQLite (WAL) adapter. Holds a single connection — SQLite is single-writer."""

    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._db = connection

    @classmethod
    async def connect(cls, path: str) -> SqliteCaptureRepository:
        connection = await aiosqlite.connect(path)
        connection.row_factory = aiosqlite.Row
        await connection.execute("PRAGMA journal_mode=WAL")
        await connection.executescript(_SCHEMA)
        await connection.commit()
        return cls(connection)

    async def close(self) -> None:
        await self._db.close()

    async def save_event(self, event: CapturedEvent) -> bool:
        is_new = await self._insert_event(event)
        await self._db.commit()
        return is_new

    async def save_risk_flag(self, flag: RiskFlag) -> None:
        await self._db.execute(
            """
            INSERT INTO risk_flags
                (reading_id, operator_id, subscriber_id, reason, score, flagged_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(reading_id) DO UPDATE SET
                reason=excluded.reason, score=excluded.score, flagged_at=excluded.flagged_at
            """,
            (
                flag.reading_id,
                flag.operator_id,
                flag.subscriber_id,
                flag.reason,
                flag.score,
                flag.flagged_at,
            ),
        )
        await self._db.commit()

    async def find_risk(self, operator_id: str, subscriber_id: str | None = None) -> list[RiskFlag]:
        query = "SELECT * FROM risk_flags WHERE operator_id = ?"
        params: list[str] = [operator_id]
        if subscriber_id is not None:
            query += " AND subscriber_id = ?"
            params.append(subscriber_id)
        query += " ORDER BY flagged_at DESC"
        async with self._db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
        return [_to_risk_flag(row) for row in rows]

    async def find_risk_by_reading(self, operator_id: str, reading_id: str) -> RiskFlag | None:
        async with self._db.execute(
            "SELECT * FROM risk_flags WHERE operator_id = ? AND reading_id = ?",
            (operator_id, reading_id),
        ) as cursor:
            row = await cursor.fetchone()
        return _to_risk_flag(row) if row else None

    async def save_label(self, label: AlertLabel) -> None:
        await self._db.execute(
            """
            INSERT INTO alert_labels (reading_id, operator_id, confirmed, labeled_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(reading_id) DO UPDATE SET
                confirmed=excluded.confirmed, labeled_at=excluded.labeled_at
            """,
            (label.reading_id, label.operator_id, int(label.confirmed), label.labeled_at),
        )
        await self._db.commit()

    async def upsert_invoice(self, entry: InvoiceLedgerEntry) -> None:
        await self._upsert_invoice(entry)
        await self._db.commit()

    async def add_payment(
        self, operator_id: str, invoice_id: str, applied_usd: float, applied_lbp: int
    ) -> None:
        await self._add_payment(operator_id, invoice_id, applied_usd, applied_lbp)
        await self._db.commit()

    async def record_invoice(self, event: CapturedEvent, entry: InvoiceLedgerEntry) -> bool:
        if not await self._insert_event(event):
            await self._db.rollback()
            return False
        await self._upsert_invoice(entry)
        await self._db.commit()
        return True

    async def record_payment(
        self, event: CapturedEvent, invoice_id: str, applied_usd: float, applied_lbp: int
    ) -> bool:
        if not await self._insert_event(event):
            await self._db.rollback()
            return False
        await self._add_payment(event.operator_id, invoice_id, applied_usd, applied_lbp)
        await self._db.commit()
        return True

    async def collection_rate(self, operator_id: str) -> CollectionRate:
        async with self._db.execute(
            """
            SELECT COALESCE(SUM(issued), 0) AS invoice_count,
                   COALESCE(SUM(amount_usd), 0) AS issued_usd,
                   COALESCE(SUM(amount_lbp), 0) AS issued_lbp,
                   COALESCE(SUM(paid_usd), 0) AS paid_usd,
                   COALESCE(SUM(paid_lbp), 0) AS paid_lbp
            FROM invoice_ledger WHERE operator_id = ?
            """,
            (operator_id,),
        ) as cursor:
            row = await cursor.fetchone()
        return CollectionRate(
            operator_id=operator_id,
            invoice_count=int(row["invoice_count"]),
            issued_usd=float(row["issued_usd"]),
            issued_lbp=int(row["issued_lbp"]),
            paid_usd=float(row["paid_usd"]),
            paid_lbp=int(row["paid_lbp"]),
        )

    async def _insert_event(self, event: CapturedEvent) -> bool:
        cursor = await self._db.execute(
            """
            INSERT INTO captured_events
                (event_id, event_type, operator_id, subscriber_id, raw_json, captured_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(event_id) DO NOTHING
            """,
            (
                event.event_id,
                event.event_type,
                event.operator_id,
                event.subscriber_id,
                event.raw_json,
                event.captured_at,
            ),
        )
        return cursor.rowcount > 0

    async def _upsert_invoice(self, entry: InvoiceLedgerEntry) -> None:
        # issued=1 marks a real invoice (vs a payment-first placeholder). The
        # operator-scoped WHERE prevents a cross-tenant event overwriting a row.
        await self._db.execute(
            """
            INSERT INTO invoice_ledger
                (invoice_id, operator_id, issued, period_start, period_end,
                 amount_usd, amount_lbp, paid_usd, paid_lbp)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(invoice_id) DO UPDATE SET
                issued=1, period_start=excluded.period_start, period_end=excluded.period_end,
                amount_usd=excluded.amount_usd, amount_lbp=excluded.amount_lbp
            WHERE invoice_ledger.operator_id = excluded.operator_id
            """,
            (
                entry.invoice_id,
                entry.operator_id,
                entry.period_start,
                entry.period_end,
                entry.amount_usd,
                entry.amount_lbp,
                entry.paid_usd,
                entry.paid_lbp,
            ),
        )

    async def _add_payment(
        self, operator_id: str, invoice_id: str, applied_usd: float, applied_lbp: int
    ) -> None:
        # A payment arriving before its invoice creates an issued=0 placeholder so
        # the payment is never lost; the placeholder is excluded from invoice_count.
        await self._db.execute(
            """
            INSERT INTO invoice_ledger
                (invoice_id, operator_id, issued, period_start, period_end,
                 amount_usd, amount_lbp, paid_usd, paid_lbp)
            VALUES (?, ?, 0, '', '', 0, 0, ?, ?)
            ON CONFLICT(invoice_id) DO UPDATE SET
                paid_usd = paid_usd + excluded.paid_usd,
                paid_lbp = paid_lbp + excluded.paid_lbp
            WHERE invoice_ledger.operator_id = excluded.operator_id
            """,
            (invoice_id, operator_id, applied_usd, applied_lbp),
        )


def _to_risk_flag(row: aiosqlite.Row) -> RiskFlag:
    return RiskFlag(
        reading_id=row["reading_id"],
        operator_id=row["operator_id"],
        subscriber_id=row["subscriber_id"],
        reason=row["reason"],
        score=float(row["score"]),
        flagged_at=row["flagged_at"],
    )
