"""Admin CRUD for Evotown-managed upstream models."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from domain.models import GatewayUpstreamModelCreate, GatewayUpstreamModelUpdate
from infra import gateway_models as models_store
from infra import litellm_sync

router = APIRouter(prefix="/api/gateway/v1", tags=["gateway-models"])


async def _maybe_sync(record: dict) -> dict:
    if not record.get("enabled"):
        return record
    creds = models_store.credentials_for_sync(record["model_id"])
    if creds is None:
        return record
    result = await litellm_sync.sync_upstream_model(
        model_name=creds["model_name"],
        api_base=creds["api_base"],
        api_key=creds["api_key"],
        litellm_model=creds["litellm_model"],
    )
    updated = models_store.record_litellm_sync(
        record["model_id"],
        synced=bool(result.get("ok")),
        litellm_model_id=str(result.get("litellm_model_id") or ""),
        sync_error=str(result.get("error") or ""),
    )
    return updated or record


@router.get("/upstream-models", dependencies=[Depends(require_admin)])
async def list_upstream_models():
    return {
        "models": models_store.list_models(),
        "litellm_configured": litellm_sync.litellm_configured(),
    }


@router.post("/upstream-models", dependencies=[Depends(require_admin)])
async def create_upstream_model(body: GatewayUpstreamModelCreate):
    name = body.model_name.strip()
    existing = models_store.get_by_model_name(name)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="model_name already exists")
    record = models_store.create_model(
        model_name=body.model_name,
        api_base=body.api_base,
        api_key=body.api_key,
        anthropic_api_base=body.anthropic_api_base,
        protocol=body.protocol,
        litellm_model=body.litellm_model,
        provider_label=body.provider_label,
        description=body.description,
        enabled=body.enabled,
        is_vision=body.is_vision,
    )
    record = await _maybe_sync(record)
    return {
        "model": record,
        "warning": "Store the API key now if needed; list endpoints only show a masked hint.",
    }


@router.patch("/upstream-models/{model_id}", dependencies=[Depends(require_admin)])
async def update_upstream_model(model_id: str, body: GatewayUpstreamModelUpdate):
    payload = body.model_dump(exclude_unset=True)
    if "model_name" in payload:
        other = models_store.get_by_model_name(payload["model_name"])
        if other and other.get("model_id") != model_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="model_name already exists")
    # If unchecking is_vision, also clear is_vision_default
    if payload.get("is_vision") is False:
        payload["is_vision_default"] = False
    record = models_store.update_model(model_id, **payload)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="model not found")
    record = await _maybe_sync(record)
    return {"model": record}


@router.post("/upstream-models/{model_id}/set-vision-default", dependencies=[Depends(require_admin)])
async def set_vision_default_model(model_id: str):
    """Set this model as the default vision model (only one at a time)."""
    record = models_store.set_vision_default(model_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                           detail="model not found or not vision-capable")
    return {"vision_model": record}


@router.delete("/upstream-models/{model_id}", dependencies=[Depends(require_admin)])
async def delete_upstream_model(model_id: str):
    record = models_store.delete_model(model_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="model not found")
    return {"deleted": True, "model": record}


@router.post("/upstream-models/{model_id}/sync-litellm", dependencies=[Depends(require_admin)])
async def resync_upstream_model(model_id: str):
    record = models_store.get_model(model_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="model not found")
    record = await _maybe_sync(record)
    return {"model": record}
