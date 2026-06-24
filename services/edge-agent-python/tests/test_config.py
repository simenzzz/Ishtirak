import pytest

from edge_agent.config import ConfigError, load_config


def test_loads_required_and_defaults():
    config = load_config({"GATEWAY_URL": "http://gw", "DEVICE_TOKEN": "t"})
    assert config.gateway_url == "http://gw"
    assert config.device_token == "t"
    assert config.mqtt_topic == "tele/+/SENSOR"
    assert config.batch_size == 200


def test_overrides_are_applied():
    config = load_config(
        {
            "GATEWAY_URL": "http://gw",
            "DEVICE_TOKEN": "t",
            "MQTT_HOST": "broker",
            "MQTT_PORT": "8883",
            "BATCH_SIZE": "50",
            "FLUSH_INTERVAL_SECS": "5",
        }
    )
    assert config.mqtt_host == "broker"
    assert config.mqtt_port == 8883
    assert config.batch_size == 50
    assert config.flush_interval_secs == 5.0


def test_missing_required_raises():
    with pytest.raises(ConfigError) as exc:
        load_config({"GATEWAY_URL": "http://gw"})
    assert "DEVICE_TOKEN" in str(exc.value)


def test_non_integer_port_raises():
    with pytest.raises(ConfigError):
        load_config({"GATEWAY_URL": "http://gw", "DEVICE_TOKEN": "t", "MQTT_PORT": "nope"})
