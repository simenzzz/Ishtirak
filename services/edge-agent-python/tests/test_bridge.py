from datetime import datetime, timezone

from edge_agent.bridge import MeterBridge
from edge_agent.buffer import ReadingBuffer
from edge_agent.uploader import UploadResult

AT = datetime(2026, 2, 1, 12, 0, 0, tzinfo=timezone.utc)


class FakeUploader:
    def __init__(self, results):
        self._results = list(results)
        self.batches = []

    def upload(self, readings):
        self.batches.append(list(readings))
        return self._results.pop(0)


def make_bridge(tmp_path, uploader, **kwargs):
    buffer = ReadingBuffer(str(tmp_path / "buf.sqlite3"))
    bridge = MeterBridge(buffer=buffer, uploader=uploader, clock=lambda: AT, **kwargs)
    return bridge, buffer


def test_handle_message_buffers_valid_and_drops_malformed(tmp_path):
    bridge, buffer = make_bridge(tmp_path, FakeUploader([]))
    assert bridge.handle_message("tele/M-7/SENSOR", '{"ENERGY":{"Total":5}}') is True
    assert bridge.handle_message("tele/M-7/SENSOR", "garbage") is False
    assert buffer.pending_count() == 1


def test_flush_uploads_and_clears_on_success(tmp_path):
    uploader = FakeUploader([UploadResult(ok=True, status=200, recorded=1)])
    bridge, buffer = make_bridge(tmp_path, uploader)
    bridge.handle_message("tele/M-7/SENSOR", '{"ENERGY":{"Total":5}}')

    handed = bridge.flush()
    assert handed == 1
    assert buffer.pending_count() == 0


def test_flush_keeps_readings_on_transient_failure(tmp_path):
    uploader = FakeUploader([UploadResult(ok=False, status=503)])
    bridge, buffer = make_bridge(tmp_path, uploader)
    bridge.handle_message("tele/M-7/SENSOR", '{"ENERGY":{"Total":5}}')

    assert bridge.flush() == 0
    assert buffer.pending_count() == 1  # retried next flush


def test_flush_drops_terminally_rejected_batch(tmp_path):
    uploader = FakeUploader([UploadResult(ok=False, status=400, terminal=True)])
    bridge, buffer = make_bridge(tmp_path, uploader)
    bridge.handle_message("tele/M-7/SENSOR", '{"ENERGY":{"Total":5}}')

    assert bridge.flush() == 0
    assert buffer.pending_count() == 0  # malformed batch dropped, not retried forever


def test_flush_drains_multiple_batches(tmp_path):
    uploader = FakeUploader([
        UploadResult(ok=True, status=200, recorded=2),
        UploadResult(ok=True, status=200, recorded=1),
    ])
    bridge, buffer = make_bridge(tmp_path, uploader, batch_size=2)
    # Three distinct instants via three different payloads at the same clock would
    # collide on idempotency key, so drive the clock forward per message.
    for minute in range(3):
        bridge._clock = lambda m=minute: AT.replace(minute=m)
        bridge.handle_message("tele/M-7/SENSOR", '{"ENERGY":{"Total":5}}')

    assert bridge.flush() == 3
    assert [len(b) for b in uploader.batches] == [2, 1]
    assert buffer.pending_count() == 0


def test_set_power_publishes_relay_command(tmp_path):
    published = []
    bridge, _ = make_bridge(
        tmp_path, FakeUploader([]), publish=lambda topic, payload: published.append((topic, payload))
    )
    bridge.set_power("M-7", on=False)
    assert published == [("cmnd/M-7/POWER", "OFF")]
