"""Admin CRUD for gateway model alias routing."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from domain.models import GatewayModelRouteCreate, GatewayModelRouteUpdate
from infra import gateway_routes

router = APIRouter(prefix="/api/gateway/v1", tags=["gateway-routes"])


@router.get("/model-routes", dependencies=[Depends(require_admin)])
async def list_model_routes():
    return {"routes": gateway_routes.list_routes()}


@router.post("/model-routes", dependencies=[Depends(require_admin)])
async def create_model_route(body: GatewayModelRouteCreate):
    route = gateway_routes.create_route(
        alias=body.alias,
        target_model=body.target_model,
        team_id=body.team_id,
        account_id=body.account_id,
        description=body.description,
        priority=body.priority,
        enabled=body.enabled,
        route_type=body.route_type,
        fallback_models=body.fallback_models,
        retry_policy=body.retry_policy,
        auto_policy=body.auto_policy,
        enable_fallback=body.enable_fallback,
    )
    return {"route": route}


@router.patch("/model-routes/{route_id}", dependencies=[Depends(require_admin)])
async def update_model_route(route_id: str, body: GatewayModelRouteUpdate):
    route = gateway_routes.update_route(
        route_id,
        **body.model_dump(exclude_unset=True),
    )
    if route is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="route not found")
    return {"route": route}


@router.delete("/model-routes/{route_id}", dependencies=[Depends(require_admin)])
async def delete_model_route(route_id: str):
    if not gateway_routes.delete_route(route_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="route not found")
    return {"deleted": True}
