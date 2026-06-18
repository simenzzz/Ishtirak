"""HTTP client for the one synchronous dependency: core-java tier lookups.

A 404 means the subscriber/tier is genuinely unknown (rule opts out). Any other
non-2xx or transport failure raises :class:`CoreJavaError` so the caller can tell
"unknown" apart from "core-java unreachable" — never silently disabling the rule.
"""

from __future__ import annotations

import logging
from urllib.parse import urlsplit
from uuid import UUID

import httpx

from app.analytics.service_token import sign_service_token
from app.redis_state.tier_cache import TierInfo

logger = logging.getLogger(__name__)


class CoreJavaError(RuntimeError):
    """core-java was reachable-but-erroring or unreachable; tier could not be resolved."""


class CoreJavaClient:
    def __init__(self, client: httpx.AsyncClient, base_url: str, service_token_secret: str) -> None:
        scheme = urlsplit(base_url).scheme
        if scheme not in ("http", "https"):
            raise ValueError(f"core_java_url must be http(s): {base_url!r}")
        self._client = client
        self._base_url = base_url.rstrip("/")
        self._secret = service_token_secret

    async def get_subscriber_tier(self, operator_id: str, subscriber_id: str) -> TierInfo | None:
        subscriber = await self._get(operator_id, f"/subscribers/{subscriber_id}")
        if subscriber is None:
            return None
        tier_id = subscriber.get("tierId")
        if not tier_id or not _is_uuid(tier_id):
            # Guard against a malformed/crafted tierId being interpolated into the URL path.
            return None
        tier = await self._get(operator_id, f"/tiers/{tier_id}")
        if tier is None:
            return None
        amperage = tier.get("amperage")
        if amperage is None:
            return None
        return TierInfo(amperage=int(amperage))

    async def _get(self, operator_id: str, path: str) -> dict | None:
        headers = {
            "Authorization": f"Bearer {sign_service_token(self._secret, operator_id)}",
            "X-Operator-Id": operator_id,
            "X-Actor-Role": "OPERATOR_STAFF",
        }
        try:
            response = await self._client.get(f"{self._base_url}{path}", headers=headers)
        except httpx.HTTPError as exc:
            logger.warning("core-java request to %s failed: %s", path, exc)
            raise CoreJavaError(str(exc)) from exc
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            logger.warning("core-java %s returned %s", path, response.status_code)
            raise CoreJavaError(f"unexpected status {response.status_code} from {path}")
        return response.json()


def _is_uuid(value: str) -> bool:
    try:
        UUID(str(value))
    except (ValueError, AttributeError):
        return False
    return True
