"""Internal analytics REST surface (consumed by the gateway in Phase 4).

Every endpoint is scoped to ``X-Operator-Id`` for multi-tenant isolation. The header
is currently trusted directly; Phase 4 hardens this to the service-token boundary
(see ROADMAP) — the same internal trust boundary core-java already enforces.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.capture.models import AlertLabel
from app.capture.repository import CaptureRepository
from app.clock import now_iso

router = APIRouter(prefix="/analytics", tags=["analytics"])


class LabelRequest(BaseModel):
    confirmed: bool


def _repo(request: Request) -> CaptureRepository:
    repo = getattr(request.app.state, "capture_repo", None)
    if repo is None:  # pragma: no cover - defensive; runtime always sets this
        raise HTTPException(status_code=503, detail="analytics store unavailable")
    return repo


def _operator_id(x_operator_id: str | None = Header(default=None, alias="X-Operator-Id")) -> str:
    if not x_operator_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="X-Operator-Id required")
    try:
        UUID(x_operator_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="X-Operator-Id must be a UUID"
        ) from exc
    return x_operator_id


@router.get("/collection-rate")
async def collection_rate(
    operator_id: str = Depends(_operator_id), repo: CaptureRepository = Depends(_repo)
) -> dict:
    summary = await repo.collection_rate(operator_id)
    return {
        "operatorId": summary.operator_id,
        "invoiceCount": summary.invoice_count,
        "issuedUsd": summary.issued_usd,
        "issuedLbp": summary.issued_lbp,
        "paidUsd": summary.paid_usd,
        "paidLbp": summary.paid_lbp,
        "collectionRateUsd": summary.collection_rate_usd,
        "collectionRateLbp": summary.collection_rate_lbp,
    }


@router.get("/risk")
async def list_risk(
    subscriber_id: str | None = None,
    operator_id: str = Depends(_operator_id),
    repo: CaptureRepository = Depends(_repo),
) -> dict:
    flags = await repo.find_risk(operator_id, subscriber_id)
    return {"data": [_risk_dict(flag) for flag in flags]}


@router.get("/risk/{reading_id}")
async def get_risk(
    reading_id: str,
    operator_id: str = Depends(_operator_id),
    repo: CaptureRepository = Depends(_repo),
) -> dict:
    flag = await repo.find_risk_by_reading(operator_id, reading_id)
    if flag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="risk flag not found")
    return _risk_dict(flag)


@router.post("/risk/{reading_id}/label", status_code=status.HTTP_204_NO_CONTENT)
async def label_risk(
    reading_id: str,
    body: LabelRequest,
    operator_id: str = Depends(_operator_id),
    repo: CaptureRepository = Depends(_repo),
) -> Response:
    flag = await repo.find_risk_by_reading(operator_id, reading_id)
    if flag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="risk flag not found")
    await repo.save_label(AlertLabel(reading_id, operator_id, body.confirmed, now_iso()))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _risk_dict(flag) -> dict:
    return {
        "readingId": flag.reading_id,
        "subscriberId": flag.subscriber_id,
        "reason": flag.reason,
        "score": flag.score,
        "flaggedAt": flag.flagged_at,
    }
