"""Asset registry API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from domain.models import AssetPropose, AssetReview
from infra import asset_registry

router = APIRouter(prefix="/api/v1/assets", tags=["assets"])


@router.post("/propose", dependencies=[Depends(require_admin)])
async def propose_asset(body: AssetPropose):
    try:
        asset = asset_registry.propose_asset(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"proposed": True, "asset": asset}


@router.get("", dependencies=[Depends(require_admin)])
async def list_assets(
    status_filter: str | None = None,
    asset_type: str | None = None,
    team_id: str | None = None,
    source_run_id: str | None = None,
    query: str | None = None,
    limit: int = 100,
):
    return {
        "assets": asset_registry.list_assets(
            status=status_filter,
            asset_type=asset_type,
            team_id=team_id,
            source_run_id=source_run_id,
            query=query,
            limit=limit,
        )
    }


@router.get("/{asset_id}", dependencies=[Depends(require_admin)])
async def get_asset(asset_id: str):
    asset = asset_registry.get_asset(asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found")
    return {"asset": asset}


@router.post("/{asset_id}/review", dependencies=[Depends(require_admin)])
async def review_asset(asset_id: str, body: AssetReview):
    asset = asset_registry.review_asset(
        asset_id,
        decision=body.decision,
        reviewer=body.reviewer,
        reason=body.reason,
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found")
    return {"reviewed": True, "asset": asset}
