"""Upload buffered readings to the Ishtirak ingest API."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import httpx

from .reading import Reading


# 4xx statuses that a retry will never fix: the batch payload itself is malformed.
# 401/403 (token) and 429 are deliberately excluded — those are recoverable once the
# operator fixes the credential or the window resets, so we keep the readings.
_TERMINAL_STATUSES = frozenset({400, 413, 422})


@dataclass(frozen=True)
class UploadResult:
    """Outcome of one upload attempt.

    ``ok`` means the batch reached the API and got a verdict (2xx); the agent may
    then clear those readings from its buffer. When ``ok`` is ``False``, ``terminal``
    distinguishes a permanently-rejected batch (malformed — drop it, never succeeds)
    from a transient failure (network/5xx/auth/429 — keep and retry after backoff).
    """

    ok: bool
    status: int
    terminal: bool = False
    recorded: int = 0
    duplicates: int = 0
    errors: tuple[dict, ...] = ()


class Uploader:
    def __init__(
        self,
        gateway_url: str,
        device_token: str,
        client: httpx.Client | None = None,
        timeout: float = 15.0,
    ) -> None:
        self._url = gateway_url.rstrip("/") + "/api/ingest/readings"
        self._headers = {"authorization": f"Bearer {device_token}"}
        self._client = client or httpx.Client(timeout=timeout)

    def upload(self, readings: Sequence[Reading]) -> UploadResult:
        if not readings:
            return UploadResult(ok=True, status=200)
        body = {"readings": [reading.to_payload() for reading in readings]}
        try:
            response = self._client.post(self._url, json=body, headers=self._headers)
        except httpx.HTTPError:
            return UploadResult(ok=False, status=0)

        if response.status_code // 100 != 2:
            return UploadResult(
                ok=False,
                status=response.status_code,
                terminal=response.status_code in _TERMINAL_STATUSES,
            )

        payload = _safe_json(response)
        return UploadResult(
            ok=True,
            status=response.status_code,
            recorded=int(payload.get("recorded", 0)),
            duplicates=int(payload.get("duplicates", 0)),
            errors=tuple(payload.get("errors", []) or ()),
        )

    def close(self) -> None:
        self._client.close()


def _safe_json(response: httpx.Response) -> dict:
    try:
        document = response.json()
    except ValueError:
        return {}
    return document if isinstance(document, dict) else {}
