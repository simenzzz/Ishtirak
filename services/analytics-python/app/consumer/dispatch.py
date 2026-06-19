"""Ack / one-retry / dead-letter semantics shared by the reading and billing consumers.

Idempotency is enforced downstream (the capture write is the dedupe gate), so a single
requeue on a transient failure is safe. Poison messages — ones that can never parse —
are dead-lettered immediately rather than retried; transient failures are requeued once
and then dead-lettered. Retry counting keys off the broker's ``redelivered`` flag, which
is a best-effort hint (a connection/channel drop can reset it), so this bounds the common
hot-loop case rather than guaranteeing an exact single retry across reconnects.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

import aio_pika

logger = logging.getLogger(__name__)


class PoisonMessage(Exception):
    """An unrecoverable message that must be dead-lettered, never retried."""


async def dispatch(
    message: aio_pika.abc.AbstractIncomingMessage,
    handle: Callable[[str], Awaitable[None]],
) -> None:
    """Decode and run ``handle``; ack on success, dead-letter poison, retry-once others."""
    raw = message.body.decode("utf-8")
    try:
        await handle(raw)
    except PoisonMessage as exc:
        logger.critical("dead-lettering poison message: %s", exc)
        await message.reject(requeue=False)
    except Exception as exc:  # noqa: BLE001 - transient failure: retry once, then dead-letter
        if message.redelivered:
            logger.error("dead-lettering message after retry: %s", exc)
            await message.reject(requeue=False)
        else:
            logger.warning("requeueing message once after transient failure: %s", exc)
            await message.reject(requeue=True)
    else:
        await message.ack()
