"""Entrypoint: wire the real MQTT client to the bridge and run the flush loop."""

from __future__ import annotations

import logging
import time

import paho.mqtt.client as mqtt

from .bridge import MeterBridge
from .buffer import ReadingBuffer
from .config import Config, load_config
from .uploader import Uploader

logger = logging.getLogger("edge_agent")


def build_client(config: Config, bridge: MeterBridge) -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

    def on_connect(_client, _userdata, _flags, _reason, _properties=None) -> None:
        logger.info("connected to broker; subscribing to %s", config.mqtt_topic)
        client.subscribe(config.mqtt_topic)

    def on_message(_client, _userdata, message: mqtt.MQTTMessage) -> None:
        bridge.handle_message(message.topic, message.payload)

    client.on_connect = on_connect
    client.on_message = on_message
    return client


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = load_config()
    buffer = ReadingBuffer(config.buffer_path)
    uploader = Uploader(config.gateway_url, config.device_token)

    client: mqtt.Client | None = None
    bridge = MeterBridge(
        buffer=buffer,
        uploader=uploader,
        batch_size=config.batch_size,
        command_prefix=config.command_prefix,
        publish=lambda topic, payload: client.publish(topic, payload) if client else None,
    )
    client = build_client(config, bridge)

    client.connect(config.mqtt_host, config.mqtt_port)
    client.loop_start()
    logger.info("edge agent started; flushing every %ss", config.flush_interval_secs)
    try:
        while True:
            time.sleep(config.flush_interval_secs)
            bridge.flush()
    except KeyboardInterrupt:  # pragma: no cover - operational shutdown path
        logger.info("shutting down")
    finally:  # pragma: no cover - operational shutdown path
        client.loop_stop()
        uploader.close()
        buffer.close()


if __name__ == "__main__":  # pragma: no cover
    main()
