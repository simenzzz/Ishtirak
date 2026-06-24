"""Durable local buffer so readings survive power/connectivity loss until uploaded."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterable
from datetime import datetime

from .reading import Reading

_SCHEMA = """
CREATE TABLE IF NOT EXISTS pending_readings (
    idempotency_key TEXT PRIMARY KEY,
    meter_id        TEXT NOT NULL,
    kwh             REAL NOT NULL,
    reading_at      TEXT NOT NULL
)
"""


class ReadingBuffer:
    """A SQLite-backed FIFO of readings awaiting upload.

    Inserts are idempotent on the reading's key, so re-capturing the same point
    (or restarting mid-flush) never duplicates work.
    """

    def __init__(self, path: str) -> None:
        # check_same_thread=False: the MQTT callback thread (add) and the flush loop
        # (take/remove) share this connection. sqlite3 connections are not safe for
        # concurrent use across threads, so a lock serialises every access below.
        self._connection = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute(_SCHEMA)
            self._connection.commit()

    def add(self, reading: Reading) -> None:
        with self._lock:
            self._connection.execute(
                "INSERT OR IGNORE INTO pending_readings VALUES (?, ?, ?, ?)",
                (reading.idempotency_key, reading.meter_id, reading.kwh, reading.reading_at_iso),
            )
            self._connection.commit()

    def pending_count(self) -> int:
        with self._lock:
            row = self._connection.execute("SELECT COUNT(*) FROM pending_readings").fetchone()
        return int(row[0])

    def take(self, limit: int) -> list[Reading]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT meter_id, kwh, reading_at FROM pending_readings ORDER BY reading_at LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            Reading(meter_id=row[0], kwh=row[1], reading_at=datetime.fromisoformat(row[2]))
            for row in rows
        ]

    def remove(self, readings: Iterable[Reading]) -> None:
        keys = [(reading.idempotency_key,) for reading in readings]
        if not keys:
            return
        with self._lock:
            self._connection.executemany(
                "DELETE FROM pending_readings WHERE idempotency_key = ?", keys
            )
            self._connection.commit()

    def close(self) -> None:
        with self._lock:
            self._connection.close()
