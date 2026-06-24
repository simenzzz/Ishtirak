# Ishtirak edge agent

Generator-site bridge that turns Tasmota meter telemetry into Ishtirak
`reading.recorded` events. Runs on a small Linux box (Raspberry Pi / OpenWrt)
next to one generator, alongside a local Mosquitto broker.

See [`docs/HARDWARE.md`](../../docs/HARDWARE.md) for the full bundle, BOM, and
Tasmota setup. This README covers the software only.

## What it does

1. Subscribes to `tele/+/SENSOR` on the local MQTT broker.
2. Parses each message's cumulative `ENERGY.Total` into a reading, stamped with
   the agent's receive time.
3. Buffers readings durably in SQLite (survives power/connectivity loss).
4. Uploads idempotent batches to `POST {GATEWAY_URL}/api/ingest/readings` with a
   device token, retrying with backoff; readings clear only on a 2xx verdict.
5. Can relay operator connect/disconnect commands to `cmnd/<meter>/POWER`.

The core logic (`parser`, `buffer`, `uploader`, `bridge`) is decoupled from MQTT
so it is unit-tested without a broker; `main.py` wires the real paho client.

## Configuration (environment)

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GATEWAY_URL` | yes | — | Ishtirak gateway base URL |
| `DEVICE_TOKEN` | yes | — | device token (prefix `ishtdev_`) |
| `MQTT_HOST` | no | `localhost` | site Mosquitto host |
| `MQTT_PORT` | no | `1883` | broker port |
| `MQTT_TOPIC` | no | `tele/+/SENSOR` | telemetry subscription |
| `COMMAND_PREFIX` | no | `cmnd` | Tasmota command topic prefix |
| `BUFFER_PATH` | no | `edge-buffer.sqlite3` | SQLite buffer path |
| `BATCH_SIZE` | no | `200` | max readings per upload |
| `FLUSH_INTERVAL_SECS` | no | `30` | seconds between flushes |

## Run

```bash
pip install -e .[dev]
GATEWAY_URL=https://gateway.example DEVICE_TOKEN=ishtdev_... ishtirak-edge-agent
```

## Test

```bash
pip install -e .[dev]
pytest          # unit tests, no broker/network required
```
