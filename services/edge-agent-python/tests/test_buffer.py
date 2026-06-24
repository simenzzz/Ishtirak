from datetime import datetime, timedelta, timezone

from edge_agent.buffer import ReadingBuffer
from edge_agent.reading import Reading

BASE = datetime(2026, 2, 1, 12, 0, 0, tzinfo=timezone.utc)


def reading(minute: int, kwh: float = 1.0, meter: str = "M-7") -> Reading:
    return Reading(meter_id=meter, kwh=kwh, reading_at=BASE + timedelta(minutes=minute))


def test_add_is_idempotent_and_take_is_ordered(tmp_path):
    buffer = ReadingBuffer(str(tmp_path / "buf.sqlite3"))
    buffer.add(reading(2))
    buffer.add(reading(0))
    buffer.add(reading(0))  # duplicate key -> ignored

    assert buffer.pending_count() == 2
    taken = buffer.take(10)
    assert [r.reading_at for r in taken] == [BASE, BASE + timedelta(minutes=2)]
    buffer.close()


def test_remove_clears_only_named_keys(tmp_path):
    buffer = ReadingBuffer(str(tmp_path / "buf.sqlite3"))
    keep, drop = reading(0), reading(1)
    buffer.add(keep)
    buffer.add(drop)

    buffer.remove([drop])
    remaining = buffer.take(10)
    assert [r.idempotency_key for r in remaining] == [keep.idempotency_key]
    buffer.close()


def test_survives_reopen(tmp_path):
    path = str(tmp_path / "buf.sqlite3")
    first = ReadingBuffer(path)
    first.add(reading(0))
    first.close()

    reopened = ReadingBuffer(path)
    assert reopened.pending_count() == 1
    reopened.close()
