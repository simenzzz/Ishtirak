"""Capture-store port plus SQLite adapter."""

from __future__ import annotations

from abc import ABC, abstractmethod

import sqlite3

from app.capture.models import AlertLabel, CapturedEvent, CollectionRate, InvoiceLedgerEntry, RiskFlag

_SCHEMA = """
CREATE TABLE IF NOT EXISTS captured_events (
    event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, operator_id TEXT NOT NULL,
    subscriber_id TEXT, raw_json TEXT NOT NULL, captured_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS risk_flags (
    reading_id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, subscriber_id TEXT NOT NULL,
    reason TEXT NOT NULL, score REAL NOT NULL, flagged_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_risk_flags_operator ON risk_flags (operator_id);
CREATE TABLE IF NOT EXISTS alert_labels (
    reading_id TEXT PRIMARY KEY, operator_id TEXT NOT NULL,
    confirmed INTEGER NOT NULL, labeled_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoice_ledger (
    invoice_id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, issued INTEGER NOT NULL DEFAULT 0,
    period_start TEXT NOT NULL, period_end TEXT NOT NULL, amount_usd REAL NOT NULL,
    amount_lbp INTEGER NOT NULL, paid_usd REAL NOT NULL DEFAULT 0,
    paid_lbp INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_invoice_ledger_operator ON invoice_ledger (operator_id);
"""


class CaptureRepository(ABC):
    @abstractmethod
    async def save_event(self, event: CapturedEvent) -> bool: ...

    @abstractmethod
    async def save_risk_flag(self, flag: RiskFlag) -> None: ...

    @abstractmethod
    async def find_risk(self, operator_id: str, subscriber_id: str | None = None) -> list[RiskFlag]: ...

    @abstractmethod
    async def find_risk_page(
        self, operator_id: str, subscriber_id: str | None, min_score: float | None, page: int, limit: int
    ) -> tuple[list[tuple[RiskFlag, str]], int]: ...

    @abstractmethod
    async def find_risk_by_reading(self, operator_id: str, reading_id: str) -> RiskFlag | None: ...

    @abstractmethod
    async def label_for_reading(self, operator_id: str, reading_id: str) -> str: ...

    @abstractmethod
    async def save_label(self, label: AlertLabel) -> None: ...

    @abstractmethod
    async def upsert_invoice(self, entry: InvoiceLedgerEntry) -> None: ...

    @abstractmethod
    async def add_payment(self, operator_id: str, invoice_id: str, applied_usd: float, applied_lbp: int) -> None: ...

    @abstractmethod
    async def record_invoice(self, event: CapturedEvent, entry: InvoiceLedgerEntry) -> bool: ...

    @abstractmethod
    async def record_payment(self, event: CapturedEvent, invoice_id: str, applied_usd: float, applied_lbp: int) -> bool: ...

    @abstractmethod
    async def collection_rate(self, operator_id: str) -> CollectionRate: ...

    @abstractmethod
    async def collection_rates(
        self, operator_id: str, period_start: str | None = None, period_end: str | None = None
    ) -> list[dict[str, object]]: ...


class SqliteCaptureRepository(CaptureRepository):
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    @classmethod
    async def connect(cls, path: str) -> SqliteCaptureRepository:
        connection = sqlite3.connect(path)
        connection.row_factory = sqlite3.Row
        if path != ":memory:":
            connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(_SCHEMA)
        connection.commit()
        return cls(connection)

    async def close(self) -> None:
        self._db.close()

    async def save_event(self, event: CapturedEvent) -> bool:
        is_new = await self._insert_event(event)
        self._db.commit()
        return is_new

    async def save_risk_flag(self, flag: RiskFlag) -> None:
        self._db.execute(
            """
            INSERT INTO risk_flags (reading_id, operator_id, subscriber_id, reason, score, flagged_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(reading_id) DO UPDATE SET
                reason=excluded.reason, score=excluded.score, flagged_at=excluded.flagged_at
            """,
            (flag.reading_id, flag.operator_id, flag.subscriber_id, flag.reason, flag.score, flag.flagged_at),
        )
        self._db.commit()

    async def find_risk(self, operator_id: str, subscriber_id: str | None = None) -> list[RiskFlag]:
        rows, _ = await self.find_risk_page(operator_id, subscriber_id, None, 1, 10_000)
        return [flag for flag, _label in rows]

    async def find_risk_page(
        self, operator_id: str, subscriber_id: str | None, min_score: float | None, page: int, limit: int
    ) -> tuple[list[tuple[RiskFlag, str]], int]:
        where, params = _risk_filters(operator_id, subscriber_id, min_score)
        count_row = await self._one(f"SELECT COUNT(*) AS total FROM risk_flags r {where}", params)
        query = f"""
            SELECT r.*, l.confirmed FROM risk_flags r
            LEFT JOIN alert_labels l ON l.operator_id = r.operator_id AND l.reading_id = r.reading_id
            {where} ORDER BY r.flagged_at DESC LIMIT ? OFFSET ?
        """
        rows = self._db.execute(query, [*params, limit, (page - 1) * limit]).fetchall()
        return [(_to_risk_flag(row), _label(row["confirmed"])) for row in rows], int(count_row["total"])

    async def find_risk_by_reading(self, operator_id: str, reading_id: str) -> RiskFlag | None:
        row = await self._one_or_none(
            "SELECT * FROM risk_flags WHERE operator_id = ? AND reading_id = ?", [operator_id, reading_id]
        )
        return _to_risk_flag(row) if row else None

    async def label_for_reading(self, operator_id: str, reading_id: str) -> str:
        row = await self._one_or_none(
            "SELECT confirmed FROM alert_labels WHERE operator_id = ? AND reading_id = ?", [operator_id, reading_id]
        )
        return "UNREVIEWED" if row is None else _label(row["confirmed"])

    async def save_label(self, label: AlertLabel) -> None:
        self._db.execute(
            """
            INSERT INTO alert_labels (reading_id, operator_id, confirmed, labeled_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(reading_id) DO UPDATE SET confirmed=excluded.confirmed, labeled_at=excluded.labeled_at
            """,
            (label.reading_id, label.operator_id, int(label.confirmed), label.labeled_at),
        )
        self._db.commit()

    async def upsert_invoice(self, entry: InvoiceLedgerEntry) -> None:
        await self._upsert_invoice(entry)
        self._db.commit()

    async def add_payment(self, operator_id: str, invoice_id: str, applied_usd: float, applied_lbp: int) -> None:
        await self._add_payment(operator_id, invoice_id, applied_usd, applied_lbp)
        self._db.commit()

    async def record_invoice(self, event: CapturedEvent, entry: InvoiceLedgerEntry) -> bool:
        if not await self._insert_event(event):
            self._db.rollback()
            return False
        await self._upsert_invoice(entry)
        self._db.commit()
        return True

    async def record_payment(self, event: CapturedEvent, invoice_id: str, applied_usd: float, applied_lbp: int) -> bool:
        if not await self._insert_event(event):
            self._db.rollback()
            return False
        await self._add_payment(event.operator_id, invoice_id, applied_usd, applied_lbp)
        self._db.commit()
        return True

    async def collection_rate(self, operator_id: str) -> CollectionRate:
        row = await self._one(
            """
            SELECT COALESCE(SUM(issued), 0) AS invoice_count, COALESCE(SUM(amount_usd), 0) AS issued_usd,
                   COALESCE(SUM(amount_lbp), 0) AS issued_lbp, COALESCE(SUM(paid_usd), 0) AS paid_usd,
                   COALESCE(SUM(paid_lbp), 0) AS paid_lbp FROM invoice_ledger WHERE operator_id = ?
            """,
            [operator_id],
        )
        return CollectionRate(operator_id, int(row["invoice_count"]), float(row["issued_usd"]), int(row["issued_lbp"]), float(row["paid_usd"]), int(row["paid_lbp"]))

    async def collection_rates(
        self, operator_id: str, period_start: str | None = None, period_end: str | None = None
    ) -> list[dict[str, object]]:
        where, params = _period_filters(operator_id, period_start, period_end)
        rows = self._db.execute(
            f"""
            SELECT period_start, period_end, SUM(amount_usd) AS issued_usd, SUM(amount_lbp) AS issued_lbp,
                   SUM(paid_usd) AS paid_usd, SUM(paid_lbp) AS paid_lbp
            FROM invoice_ledger {where}
            GROUP BY period_start, period_end ORDER BY period_end DESC
            """,
            params,
        ).fetchall()
        return [_period_rate(row) for row in rows]

    async def _insert_event(self, event: CapturedEvent) -> bool:
        cursor = self._db.execute(
            """
            INSERT INTO captured_events (event_id, event_type, operator_id, subscriber_id, raw_json, captured_at)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING
            """,
            (event.event_id, event.event_type, event.operator_id, event.subscriber_id, event.raw_json, event.captured_at),
        )
        return cursor.rowcount > 0

    async def _upsert_invoice(self, entry: InvoiceLedgerEntry) -> None:
        self._db.execute(
            """
            INSERT INTO invoice_ledger
                (invoice_id, operator_id, issued, period_start, period_end, amount_usd, amount_lbp, paid_usd, paid_lbp)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(invoice_id) DO UPDATE SET issued=1, period_start=excluded.period_start,
                period_end=excluded.period_end, amount_usd=excluded.amount_usd, amount_lbp=excluded.amount_lbp
            WHERE invoice_ledger.operator_id = excluded.operator_id
            """,
            (entry.invoice_id, entry.operator_id, entry.period_start, entry.period_end, entry.amount_usd, entry.amount_lbp, entry.paid_usd, entry.paid_lbp),
        )

    async def _add_payment(self, operator_id: str, invoice_id: str, applied_usd: float, applied_lbp: int) -> None:
        self._db.execute(
            """
            INSERT INTO invoice_ledger
                (invoice_id, operator_id, issued, period_start, period_end, amount_usd, amount_lbp, paid_usd, paid_lbp)
            VALUES (?, ?, 0, '', '', 0, 0, ?, ?)
            ON CONFLICT(invoice_id) DO UPDATE SET paid_usd = paid_usd + excluded.paid_usd,
                paid_lbp = paid_lbp + excluded.paid_lbp WHERE invoice_ledger.operator_id = excluded.operator_id
            """,
            (invoice_id, operator_id, applied_usd, applied_lbp),
        )

    async def _one(self, query: str, params: list[object]) -> sqlite3.Row:
        row = await self._one_or_none(query, params)
        if row is None:
            raise RuntimeError("query returned no rows")
        return row

    async def _one_or_none(self, query: str, params: list[object]) -> sqlite3.Row | None:
        return self._db.execute(query, params).fetchone()


def _risk_filters(operator_id: str, subscriber_id: str | None, min_score: float | None) -> tuple[str, list[object]]:
    clauses, params = ["r.operator_id = ?"], [operator_id]
    if subscriber_id:
        clauses.append("r.subscriber_id = ?")
        params.append(subscriber_id)
    if min_score is not None:
        clauses.append("r.score >= ?")
        params.append(min_score)
    return "WHERE " + " AND ".join(clauses), params


def _period_filters(
    operator_id: str, period_start: str | None, period_end: str | None
) -> tuple[str, list[object]]:
    clauses, params = ["operator_id = ?", "issued = 1"], [operator_id]
    if period_start is not None:
        clauses.append("period_start >= ?")
        params.append(period_start)
    if period_end is not None:
        clauses.append("period_end <= ?")
        params.append(period_end)
    return "WHERE " + " AND ".join(clauses), params


def _to_risk_flag(row: sqlite3.Row) -> RiskFlag:
    return RiskFlag(row["reading_id"], row["operator_id"], row["subscriber_id"], row["reason"], float(row["score"]), row["flagged_at"])


def _label(confirmed: object) -> str:
    if confirmed is None:
        return "UNREVIEWED"
    return "CONFIRMED" if int(confirmed) == 1 else "DISMISSED"


def _period_rate(row: sqlite3.Row) -> dict[str, object]:
    issued_usd, paid_usd = float(row["issued_usd"]), float(row["paid_usd"])
    return {
        "periodStart": row["period_start"],
        "periodEnd": row["period_end"],
        "issuedUsd": issued_usd,
        "issuedLbp": int(row["issued_lbp"]),
        "collectedUsd": paid_usd,
        "collectedLbp": int(row["paid_lbp"]),
        "rate": round(paid_usd / issued_usd, 4) if issued_usd else 0.0,
    }
