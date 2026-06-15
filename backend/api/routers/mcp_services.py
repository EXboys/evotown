"""MCP service management API — admin panel endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from core.auth import require_admin
from infra import mcp_registry, workspaces

router = APIRouter(prefix="/api/v1", tags=["mcp"])


class McpPolicyUpdate(BaseModel):
    enabled: bool = True
    row_rules: list[dict[str, Any]] = Field(default_factory=list)


class BatchPolicyItem(BaseModel):
    workspace_id: str
    enabled: bool = True
    row_rules: list[dict[str, Any]] = Field(default_factory=list)


class BatchPolicyUpdate(BaseModel):
    policies: list[BatchPolicyItem] = Field(default_factory=list)


# ── MCP Services (admin) ───────────────────────────────────────────────

@router.get("/mcp-services", dependencies=[Depends(require_admin)])
async def list_mcp_services():
    services = mcp_registry.list_services()
    return {"services": services, "stats": mcp_registry.registry_stats()}


@router.get("/mcp-services/{service_id}", dependencies=[Depends(require_admin)])
async def get_mcp_service(service_id: str):
    svc = mcp_registry.get_service(service_id)
    if svc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    policies = mcp_registry.list_policies_for_service(service_id)
    role_policies = mcp_registry.list_role_policies_for_service(service_id)
    roles = mcp_registry.list_roles()
    return {"service": svc, "policies": policies, "role_policies": role_policies, "roles": roles}


# ── Workspace Policies (admin) ─────────────────────────────────────────

@router.get("/mcp-services/{service_id}/policies", dependencies=[Depends(require_admin)])
async def get_service_policies(service_id: str):
    if mcp_registry.get_service(service_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    policies = mcp_registry.list_policies_for_service(service_id)
    return {"service_id": service_id, "policies": policies}


@router.put("/mcp-services/{service_id}/policies")
async def update_service_policies(service_id: str, body: BatchPolicyUpdate, _admin=Depends(require_admin)):
    if mcp_registry.get_service(service_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    created: list[dict[str, Any]] = []
    for item in body.policies:
        if not workspaces.get_workspace(item.workspace_id):
            continue
        policy = mcp_registry.set_policy(
            service_id,
            item.workspace_id,
            enabled=item.enabled,
            row_rules=item.row_rules,
        )
        created.append(policy)
    return {"service_id": service_id, "policies": created}


@router.delete("/mcp-services/{service_id}/policies/{workspace_id}")
async def delete_service_policy(service_id: str, workspace_id: str, _admin=Depends(require_admin)):
    deleted = mcp_registry.delete_policy(service_id, workspace_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="policy not found")
    return {"deleted": True}


# ── Agent runtime (no admin required) ──────────────────────────────────

@router.get("/workspaces/{workspace_id}/mcp")
async def get_workspace_mcp(workspace_id: str):
    """Called by Agent runtime to get MCP connections for a workspace."""
    workspace = workspaces.get_workspace(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workspace not found")
    connections = mcp_registry.list_policies_for_workspace(workspace_id)
    return {"workspace_id": workspace_id, "mcp": connections}


# ── Role CRUD (admin) ───────────────────────────────────────────────────

class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = ""


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class RoleMembersUpdate(BaseModel):
    workspace_ids: list[str] = Field(default_factory=list)


class RolePolicyBatchItem(BaseModel):
    role_id: str
    enabled: bool = True
    row_rules: list[dict[str, Any]] = Field(default_factory=list)


class RolePolicyBatchUpdate(BaseModel):
    policies: list[RolePolicyBatchItem] = Field(default_factory=list)


@router.get("/mcp-roles", dependencies=[Depends(require_admin)])
async def list_roles():
    roles = mcp_registry.list_roles()
    return {"roles": roles}


@router.post("/mcp-roles")
async def create_role(body: RoleCreate, _admin=Depends(require_admin)):
    role = mcp_registry.create_role(name=body.name, description=body.description)
    return {"role": role}


@router.put("/mcp-roles/{role_id}")
async def update_role(role_id: str, body: RoleUpdate, _admin=Depends(require_admin)):
    role = mcp_registry.update_role(role_id, name=body.name, description=body.description)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    return {"role": role}


@router.delete("/mcp-roles/{role_id}")
async def delete_role(role_id: str, _admin=Depends(require_admin)):
    if not mcp_registry.delete_role(role_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    return {"deleted": True}


@router.get("/mcp-roles/{role_id}/members", dependencies=[Depends(require_admin)])
async def get_role_members(role_id: str):
    if mcp_registry.get_role(role_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    return {"role_id": role_id, "members": mcp_registry.list_role_members(role_id)}


@router.put("/mcp-roles/{role_id}/members")
async def set_role_members(role_id: str, body: RoleMembersUpdate, _admin=Depends(require_admin)):
    if mcp_registry.get_role(role_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    members = mcp_registry.set_role_members(role_id, body.workspace_ids)
    return {"role_id": role_id, "members": members}


@router.get("/mcp-services/{service_id}/role-policies", dependencies=[Depends(require_admin)])
async def get_service_role_policies(service_id: str):
    if mcp_registry.get_service(service_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    return {"service_id": service_id, "role_policies": mcp_registry.list_role_policies_for_service(service_id)}


@router.put("/mcp-services/{service_id}/role-policies")
async def update_service_role_policies(service_id: str, body: RolePolicyBatchUpdate, _admin=Depends(require_admin)):
    if mcp_registry.get_service(service_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    created: list[dict[str, Any]] = []
    for item in body.policies:
        if mcp_registry.get_role(item.role_id) is None:
            continue
        policy = mcp_registry.set_role_policy(
            service_id,
            item.role_id,
            enabled=item.enabled,
            row_rules=item.row_rules,
        )
        created.append(policy)
    return {"service_id": service_id, "role_policies": created}


@router.delete("/mcp-services/{service_id}/role-policies/{role_id}")
async def delete_service_role_policy(service_id: str, role_id: str, _admin=Depends(require_admin)):
    if not mcp_registry.delete_role_policy(service_id, role_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role policy not found")
    return {"deleted": True}
