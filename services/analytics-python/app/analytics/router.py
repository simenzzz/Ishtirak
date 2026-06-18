"""Internal analytics REST surface consumed by the gateway."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.analytics.service_token_verifier import ServiceIdentity, verify_gateway_service_token
from app.capture.models import AlertLabel, RiskFlag
from app.capture.repository import CaptureRepository
from app.clock import now_iso

router = APIRouter(prefix="/analytics", tags=["analytics"])


class LabelRequest(BaseModel):
    label: str


async def _repo(request: Request) -> CaptureRepository:
    repo = getattr(request.app.state, "capture_repo", None)
    if repo is None:  # pragma: no cover - defensive; runtime always sets this
        raise HTTPException(status_code=503, detail="analytics store unavailable")
    return repo


@router.get("/collection-rate")
async def collection_rate(
    period_start: str | None = Query(default=None, alias="periodStart"),
    period_end: str | None = Query(default=None, alias="periodEnd"),
    identity: ServiceIdentity = Depends(verify_gateway_service_token),
    repo: CaptureRepository = Depends(_repo),
) -> list[dict[str, object]]:
    return await repo.collection_rates(identity.operator_id, period_start, period_end)


@router.get("/risk")
async def list_risk(
    subscriber_id: str | None = Query(default=None, alias="subscriberId"),
    min_score: float | None = Query(default=None, ge=0, le=1, alias="minScore"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    identity: ServiceIdentity = Depends(verify_gateway_service_token),
    repo: CaptureRepository = Depends(_repo),
) -> dict:
    _validate_uuid(subscriber_id, "subscriberId")
    rows, total = await repo.find_risk_page(identity.operator_id, subscriber_id, min_score, page, limit)
    return {
        "data": [_risk_dict(flag, label) for flag, label in rows],
        "meta": {"total": total, "page": page, "limit": limit},
    }


@router.get("/risk/{reading_id}")
async def get_risk(
    reading_id: str,
    identity: ServiceIdentity = Depends(verify_gateway_service_token),
    repo: CaptureRepository = Depends(_repo),
) -> dict:
    flag = await repo.find_risk_by_reading(identity.operator_id, reading_id)
    if flag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="risk flag not found")
    return _risk_dict(flag, await repo.label_for_reading(identity.operator_id, reading_id))


@router.post("/risk/{reading_id}/label")
async def label_risk(
    reading_id: str,
    body: LabelRequest,
    identity: ServiceIdentity = Depends(verify_gateway_service_token),
    repo: CaptureRepository = Depends(_repo),
) -> dict:
    if body.label not in {"CONFIRMED", "DISMISSED"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid label")
    flag = await repo.find_risk_by_reading(identity.operator_id, reading_id)
    if flag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="risk flag not found")
    await repo.save_label(AlertLabel(reading_id, identity.operator_id, body.label == "CONFIRMED", now_iso()))
    return _risk_dict(flag, body.label)


def _validate_uuid(value: str | None, field: str) -> None:
    if value is None:
        return
    try:
        UUID(value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} must be a UUID") from exc


def _risk_dict(flag: RiskFlag, label: str) -> dict:
    return {
        "readingId": flag.reading_id,
        "subscriberId": flag.subscriber_id,
        "reason": flag.reason,
        "score": flag.score,
        "label": label,
        "scoredAt": flag.flagged_at,
    }
