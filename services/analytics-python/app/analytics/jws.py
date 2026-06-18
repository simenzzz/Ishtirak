"""Compact HS256 JWS helpers shared by service-token signers/verifiers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json


def encode_segment(obj: dict[str, object]) -> str:
    return b64(json.dumps(obj, separators=(",", ":")).encode("utf-8"))


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def decode_segment(segment: str) -> dict[str, object]:
    padded = segment + "=" * (-len(segment) % 4)
    value = json.loads(base64.urlsafe_b64decode(padded))
    if not isinstance(value, dict):
        raise ValueError("JWS segment must decode to object")
    return value


def sign(signing_input: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256).digest()
    return b64(digest)


def constant_time_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("ascii"), right.encode("ascii"))
