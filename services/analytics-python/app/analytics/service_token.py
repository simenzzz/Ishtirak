"""Mint analytics-python service tokens accepted by core-java's verifier.

The wire format mirrors core-java exactly: a compact HS256 JWS
(``base64url(header).base64url(payload).base64url(HMAC-SHA256)``) with the
issuer ``analytics-python``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

ISSUER = "analytics-python"
AUDIENCE = "core-java"


def sign_service_token(
    secret: str, operator_id: str, role: str = "OPERATOR_STAFF", ttl_secs: int = 300
) -> str:
    header = _segment({"alg": "HS256", "typ": "JWT"})
    payload = _segment(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "typ": "service",
            "exp": int(time.time()) + ttl_secs,
            "operatorId": operator_id,
            "role": role,
        }
    )
    signing_input = f"{header}.{payload}"
    signature = hmac.new(
        secret.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256
    ).digest()
    return f"{signing_input}.{_b64(signature)}"


def _segment(obj: dict[str, object]) -> str:
    return _b64(json.dumps(obj, separators=(",", ":")).encode("utf-8"))


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
