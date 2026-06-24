# Hardware: physical-meter ingestion

How a per-subscriber meter becomes a `reading.recorded` event. This is the
deployable bundle behind the [ROADMAP](./ROADMAP.md) "Physical meter ingestion"
epic.

## Topology

```
Subscriber home          Generator site (one box)              Ishtirak cloud
┌──────────────┐  WiFi   ┌──────────────────────────┐  HTTPS  ┌──────────────┐
│ DDS238-2     │ ──────▶ │ Mosquitto (local broker) │ ──────▶ │ gateway-node │
│ Tasmota      │  MQTT   │ edge-agent (Python)      │ device  │ /api/ingest  │
│ relay + kWh  │ ◀────── │  tele/+/SENSOR → buffer  │ token   │ → core-java  │
└──────────────┘ cmnd    │  batched upload          │         │ reading.     │
                          └──────────────────────────┘         │ recorded     │
                                                                └──────────────┘
```

## Bill of materials

**Per subscriber (~$25–42):**

| Item | Model | ~Cost |
| --- | --- | --- |
| WiFi breaker-meter w/ relay | Hiking DDS238-2 (ESP8266 TYWE3S) or Tuya/eWeLink equivalent | $20–35 |
| DIN enclosure + wiring tails | — | $3–5 |
| Tasmota reflash (one-time labor) | bench serial flash, then OTA | ~$2 |

**Per generator site (~$110–230, amortized over its subscribers):**

| Item | Purpose | ~Cost |
| --- | --- | --- |
| Raspberry Pi 4 / OpenWrt box | runs Mosquitto + edge-agent | $40–70 |
| 4G router + SIM | cloud backhaul | $30–60 + data |
| WiFi AP / extenders | home coverage across the neighborhood | $20–40 each |
| UPS / 12V buffer | survive generator-off windows | $20–40 |

> **Sourcing caution:** only buy DDS238-2 revisions confirmed to carry the
> **ESP8266 TYWE3S** module — newer revisions ship non-ESP MCUs that Tasmota
> cannot drive. Verify the PCB before any bulk order.

## Tasmota meter setup (per device, one-time)

1. Flash Tasmota (bench, serial) and apply the **DDS238-2 template** (GPIO →
   energy monitor + relay).
2. `Topic <meterSerial>` — this serial is the subscriber's `meterId` in core-java.
3. `TelePeriod 60` — publish cumulative energy each minute.
4. Point MQTT at the site Mosquitto broker; set `PowerOnState` so a generator
   restart re-energizes the load.
5. In Ishtirak, create the subscriber with `meterId = <meterSerial>` (the meter
   id is unique per operator).

Tasmota then publishes `tele/<meterSerial>/SENSOR` like:

```json
{ "Time": "2026-02-01T12:00:00", "ENERGY": { "Total": 120.5, "Power": 240 } }
```

The edge agent reads `ENERGY.Total` (cumulative kWh) and stamps the reading with
its own receive time (avoiding Tasmota's timezone-less local clock).

## Edge agent deployment (per site)

`services/edge-agent-python` — see its [README](../services/edge-agent-python/README.md).

1. Mint a device token (operator admin): `POST /api/devices {"label":"Site A"}` →
   copy the one-time `token` (prefix `ishtdev_`).
2. Install: `pip install -e .` in `services/edge-agent-python`.
3. Configure via env and run `ishtirak-edge-agent`:

   ```bash
   export GATEWAY_URL=https://gateway.ishtirak.example
   export DEVICE_TOKEN=ishtdev_...      # from step 1
   export MQTT_HOST=localhost            # the site Mosquitto
   export BUFFER_PATH=/var/lib/ishtirak/edge-buffer.sqlite3
   ishtirak-edge-agent
   ```

The agent subscribes to `tele/+/SENSOR`, buffers every reading to SQLite (so
power/connectivity loss is survivable), and uploads idempotent batches to
`/api/ingest/readings`. Readings clear from the buffer only on a 2xx verdict.

## Security notes

- The device token is the only ingest credential; it is operator-scoped and
  **revocable** (`POST /api/devices/{id}/revoke`). Rotate on box loss/theft.
- core-java stores only the SHA-256 hash of the token; the plaintext is shown
  once at mint.
- The ingest endpoint is rate-limited per device at the gateway and globally in
  core-java.
- Remote disconnect (`cmnd/<meter>/POWER`) is wired in the agent but **not yet**
  exposed as an operator action — that surface needs admin gating + an audit log
  before production use.
