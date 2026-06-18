"""Mint analytics-python service tokens accepted by core-java's verifier.

The wire format mirrors core-java exactly: a compact HS256 JWS
(``base64url(header).base64url(payload).base64url(HMAC-SHA256)``) with the
issuer ``analytics-python``.
"""

from __future__ import annotations

import time

from app.analytics.jws import encode_segment, sign

ISSUER = "analytics-python"
AUDIENCE = "core-java"


def sign_service_token(
    secret: str, operator_id: str, role: str = "OPERATOR_STAFF", ttl_secs: int = 300
) -> str:
    header = encode_segment({"alg": "HS256", "typ": "JWT"})
    payload = encode_segment(
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
    return f"{signing_input}.{sign(signing_input, secret)}"
