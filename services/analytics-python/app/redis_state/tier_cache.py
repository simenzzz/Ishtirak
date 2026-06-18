"""Cached subscriber tier amperage, fetched from core-java on a miss."""

from __future__ import annotations

import json
from dataclasses import dataclass

from redis.asyncio import Redis


@dataclass(frozen=True)
class TierInfo:
    """Subscriber tier facts relevant to detection. ``amperage`` is the cap in amps."""

    amperage: int


def _key(operator_id: str, subscriber_id: str) -> str:
    return f"analytics:tier:{operator_id}:{subscriber_id}"


async def get_tier(redis: Redis, operator_id: str, subscriber_id: str) -> TierInfo | None:
    raw = await redis.get(_key(operator_id, subscriber_id))
    if raw is None:
        return None
    data = json.loads(raw)
    return TierInfo(amperage=int(data["amperage"]))


async def save_tier(
    redis: Redis, operator_id: str, subscriber_id: str, tier: TierInfo, ttl_secs: int
) -> None:
    await redis.set(
        _key(operator_id, subscriber_id),
        json.dumps({"amperage": tier.amperage}),
        ex=ttl_secs,
    )
