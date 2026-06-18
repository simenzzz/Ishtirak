"""The analytics service token matches the compact HS256 format core-java verifies."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json

from app.analytics.service_token import sign_service_token

_SECRET = "test-analytics-service-token-secret-32"
_OP = "11111111-1111-1111-1111-111111111111"


def _decode(segment: str) -> dict:
    padded = segment + "=" * (-len(segment) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def test_token_has_three_segments_and_expected_claims() -> None:
    token = sign_service_token(_SECRET, _OP)
    header_b64, payload_b64, signature_b64 = token.split(".")

    assert _decode(header_b64) == {"alg": "HS256", "typ": "JWT"}
    payload = _decode(payload_b64)
    assert payload["iss"] == "analytics-python"
    assert payload["aud"] == "core-java"
    assert payload["typ"] == "service"
    assert payload["operatorId"] == _OP
    assert payload["role"] == "OPERATOR_STAFF"
    assert payload["exp"] > 0


def test_signature_verifies_with_secret() -> None:
    token = sign_service_token(_SECRET, _OP)
    header_b64, payload_b64, signature_b64 = token.split(".")

    expected = hmac.new(
        _SECRET.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256
    ).digest()
    expected_b64 = base64.urlsafe_b64encode(expected).rstrip(b"=").decode()
    assert signature_b64 == expected_b64
