from datetime import datetime, timezone

import pytest

from edge_agent.parser import TelemetryError, meter_id_from_topic, parse_sensor

AT = datetime(2026, 2, 1, 12, 0, 0, tzinfo=timezone.utc)


def test_parses_cumulative_total_and_uses_capture_time():
    reading = parse_sensor("tele/M-7/SENSOR", '{"ENERGY":{"Total":120.5}}', AT)
    assert reading.meter_id == "M-7"
    assert reading.kwh == 120.5
    assert reading.reading_at == AT
    assert reading.to_payload() == {
        "meterId": "M-7",
        "kwh": 120.5,
        "readingAt": "2026-02-01T12:00:00.000000Z",
    }


def test_meter_id_from_topic_rejects_unexpected_shapes():
    assert meter_id_from_topic("tele/M-7/SENSOR") == "M-7"
    for bad in ["tele/M-7/STATE", "stat/M-7/SENSOR", "tele//SENSOR", "M-7"]:
        with pytest.raises(TelemetryError):
            meter_id_from_topic(bad)


@pytest.mark.parametrize(
    "payload",
    ['not json', '{"ENERGY":{}}', '{"ENERGY":{"Total":"abc"}}', '{"ENERGY":{"Total":-1}}', '[]'],
)
def test_rejects_malformed_payloads(payload):
    with pytest.raises(TelemetryError):
        parse_sensor("tele/M-7/SENSOR", payload, AT)


def test_idempotency_key_is_stable_per_meter_and_instant():
    a = parse_sensor("tele/M-7/SENSOR", '{"ENERGY":{"Total":1}}', AT)
    b = parse_sensor("tele/M-7/SENSOR", '{"ENERGY":{"Total":2}}', AT)
    other = parse_sensor("tele/M-8/SENSOR", '{"ENERGY":{"Total":1}}', AT)
    assert a.idempotency_key == b.idempotency_key  # same meter + instant
    assert a.idempotency_key != other.idempotency_key
