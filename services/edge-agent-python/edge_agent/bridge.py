"""Core bridge logic: telemetry in, batched uploads out, commands relayed.

Deliberately free of paho/MQTT specifics so it can be unit-tested without a broker;
:mod:`edge_agent.main` wires the real client to :meth:`MeterBridge.handle_message`.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timezone

from .buffer import ReadingBuffer
from .parser import TelemetryError, parse_sensor
from .uploader import Uploader

logger = logging.getLogger("edge_agent.bridge")

Publisher = Callable[[str, str], None]
Clock = Callable[[], datetime]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class MeterBridge:
    def __init__(
        self,
        buffer: ReadingBuffer,
        uploader: Uploader,
        batch_size: int = 200,
        command_prefix: str = "cmnd",
        publish: Publisher | None = None,
        clock: Clock = _utc_now,
    ) -> None:
        self._buffer = buffer
        self._uploader = uploader
        self._batch_size = batch_size
        self._command_prefix = command_prefix
        self._publish = publish
        self._clock = clock

    def handle_message(self, topic: str, payload: bytes | str) -> bool:
        """Capture one telemetry message. Returns True if a reading was buffered."""
        try:
            reading = parse_sensor(topic, payload, self._clock())
        except TelemetryError as exc:
            logger.warning("dropping malformed telemetry: %s", exc)
            return False
        self._buffer.add(reading)
        return True

    def flush(self) -> int:
        """Upload buffered readings until drained or a transient failure stops us.

        Returns the number of readings handed off to the API this call.
        """
        handed_off = 0
        while True:
            batch = self._buffer.take(self._batch_size)
            if not batch:
                return handed_off
            result = self._uploader.upload(batch)
            if not result.ok:
                if not result.terminal:
                    logger.warning(
                        "upload failed (status=%s); keeping %d readings to retry", result.status, len(batch)
                    )
                    return handed_off
                # Malformed batch the API will never accept — drop it so it can't
                # block the buffer forever, but log loudly: this is an agent bug.
                logger.error("dropping %d readings; ingest rejected batch (status=%s)", len(batch), result.status)
                self._buffer.remove(batch)
                continue
            if result.errors:
                logger.warning("ingest rejected %d reading(s): %s", len(result.errors), result.errors)
            # The API has ruled on every item (recorded, duplicate, or per-item
            # error); none are retriable at the agent, so clear the whole batch.
            self._buffer.remove(batch)
            handed_off += len(batch)
            if len(batch) < self._batch_size:
                return handed_off

    def set_power(self, meter_id: str, on: bool) -> None:
        """Relay an operator connect/disconnect command to a meter's Tasmota relay."""
        if self._publish is None:
            raise RuntimeError("no MQTT publisher configured for commands")
        self._publish(f"{self._command_prefix}/{meter_id}/POWER", "ON" if on else "OFF")
