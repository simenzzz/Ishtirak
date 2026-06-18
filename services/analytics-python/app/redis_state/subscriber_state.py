"""Per-subscriber rolling consumption state, persisted in Redis.

State is treated immutably: :func:`roll` returns a new :class:`SubscriberState`
rather than mutating the previous one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from redis.asyncio import Redis


@dataclass(frozen=True)
class SubscriberState:
    previous_kwh: float
    previous_reading_at: str
    trailing_deltas: tuple[float, ...]


def _key(operator_id: str, subscriber_id: str) -> str:
    return f"analytics:state:{operator_id}:{subscriber_id}"


async def get_state(redis: Redis, operator_id: str, subscriber_id: str) -> SubscriberState | None:
    raw = await redis.get(_key(operator_id, subscriber_id))
    if raw is None:
        return None
    data = json.loads(raw)
    return SubscriberState(
        previous_kwh=float(data["previous_kwh"]),
        previous_reading_at=str(data["previous_reading_at"]),
        trailing_deltas=tuple(float(d) for d in data["trailing_deltas"]),
    )


async def save_state(
    redis: Redis, operator_id: str, subscriber_id: str, state: SubscriberState
) -> None:
    payload = json.dumps(
        {
            "previous_kwh": state.previous_kwh,
            "previous_reading_at": state.previous_reading_at,
            "trailing_deltas": list(state.trailing_deltas),
        }
    )
    await redis.set(_key(operator_id, subscriber_id), payload)


def roll(
    previous: SubscriberState | None,
    kwh: float,
    reading_at: str,
    delta: float | None,
    window: int,
) -> SubscriberState:
    """Compute the next immutable state after observing a reading.

    On cold start (``previous is None`` / ``delta is None``) no delta is recorded;
    otherwise the new delta is prepended and the trailing window is truncated.
    """

    if previous is None or delta is None:
        deltas = previous.trailing_deltas if previous is not None else ()
    else:
        deltas = (delta, *previous.trailing_deltas)[:window]
    return SubscriberState(previous_kwh=kwh, previous_reading_at=reading_at, trailing_deltas=deltas)
