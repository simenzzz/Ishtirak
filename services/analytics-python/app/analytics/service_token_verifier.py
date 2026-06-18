"""Verify gateway-signed service tokens on analytics REST endpoints."""

from __future__ import annotations

import time
from dataclasses import dataclass

from fastapi import Header, HTTPException, Request, status

from app.analytics.jws import constant_time_equal, decode_segment, sign


@dataclass(frozen=True)
class ServiceIdentity:
    operator_id: str
    role: str


async def verify_gateway_service_token(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_operator_id: str | None = Header(default=None, alias="X-Operator-Id"),
    x_actor_role: str | None = Header(default=None, alias="X-Actor-Role"),
) -> ServiceIdentity:
    if not authorization or not authorization.startswith("Bearer ") or not x_operator_id or not x_actor_role:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="service token required")
    settings = request.app.state.ctx.settings
    claims = _verify_token(authorization[7:], settings.gateway_service_token_secret)
    if claims.get("operatorId") != x_operator_id or claims.get("role") != x_actor_role:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="service token header mismatch")
    if x_actor_role not in {"OPERATOR_ADMIN", "OPERATOR_STAFF"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="operator role required")
    return ServiceIdentity(operator_id=x_operator_id, role=x_actor_role)


def _verify_token(token: str, secret: str) -> dict[str, object]:
    try:
        header_b64, payload_b64, signature = token.split(".")
        header = decode_segment(header_b64)
        claims = decode_segment(payload_b64)
        if header.get("alg") != "HS256" or header.get("typ") != "JWT":
            raise ValueError("invalid header")
        if (
            claims.get("iss") != "gateway-node"
            or claims.get("aud") != "analytics-python"
            or claims.get("typ") != "service"
        ):
            raise ValueError("invalid claims")
        exp = claims.get("exp")
        if not isinstance(exp, int | float) or int(exp) <= int(time.time()):
            raise ValueError("expired")
        expected = sign(f"{header_b64}.{payload_b64}", secret)
        if not constant_time_equal(signature, expected):
            raise ValueError("bad signature")
        return claims
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid service token") from exc
