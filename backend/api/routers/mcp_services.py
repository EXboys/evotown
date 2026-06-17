"""MCP service management API — admin panel endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from core.auth import require_admin, require_console_read
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

class McpServiceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = ""
    service_type: str = "api"
    endpoint_url: str = ""
    source: str = "external"


class McpServiceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    endpoint_url: str | None = None
    source: str | None = None


class McpStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=32)


@router.get("/mcp-services", dependencies=[Depends(require_admin)])
async def list_mcp_services(
    source: str | None = None,
    search: str | None = None,
):
    services = mcp_registry.list_services(source=source)
    # Client-side search: name fuzzy OR service_id exact
    if search:
        search_lower = search.strip().lower()
        services = [
            s for s in services
            if search_lower in s.get("name", "").lower()
            or s.get("service_id", "") == search.strip()
        ]
    # Attach per-service stats
    for svc in services:
        svc["bound_workspaces"] = mcp_registry.count_service_policies(svc["service_id"])
        svc["calls_24h"] = mcp_registry.count_mcp_calls(svc["service_id"])
    return {"services": services, "stats": mcp_registry.registry_stats()}


@router.post("/mcp-services")
async def create_mcp_service(body: McpServiceCreate, _admin=Depends(require_admin)):
    svc = mcp_registry.register_service(
        name=body.name,
        description=body.description,
        service_type=body.service_type,
        endpoint_url=body.endpoint_url,
        source=body.source,
    )
    return {"service": svc}


@router.put("/mcp-services/{service_id}")
async def update_mcp_service(service_id: str, body: McpServiceUpdate, _admin=Depends(require_admin)):
    try:
        svc = mcp_registry.update_service(
            service_id,
            name=body.name,
            description=body.description,
            endpoint_url=body.endpoint_url,
            source=body.source,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    if svc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    return {"service": svc}


@router.put("/mcp-services/{service_id}/status")
async def update_mcp_status(service_id: str, body: McpStatusUpdate, _admin=Depends(require_admin)):
    try:
        svc = mcp_registry.update_service(service_id, status=body.status)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    if svc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    return {"service": svc}


@router.delete("/mcp-services/{service_id}")
async def delete_mcp_service(service_id: str, _admin=Depends(require_admin)):
    try:
        deleted = mcp_registry.delete_service(service_id)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    return {"deleted": True}


@router.get("/mcp-services/{service_id}", dependencies=[Depends(require_admin)])
async def get_mcp_service(service_id: str):
    svc = mcp_registry.get_service(service_id)
    if svc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    policies = mcp_registry.list_policies_for_service(service_id)
    role_policies = mcp_registry.list_role_policies_for_service(service_id)
    roles = mcp_registry.list_roles()
    stats = {
        "bound_workspaces": mcp_registry.count_service_policies(service_id),
        "calls_24h": mcp_registry.count_mcp_calls(service_id),
    }
    return {"service": svc, "policies": policies, "role_policies": role_policies, "roles": roles, "stats": stats}


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


class RoleFunctionsUpdate(BaseModel):
    func_ids: list[str] = Field(default_factory=list)


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


@router.get("/mcp-roles/{role_id}/services", dependencies=[Depends(require_admin)])
async def get_role_mcp_services(role_id: str):
    """List all MCP services and this role's policy status for each."""
    if mcp_registry.get_role(role_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    services = mcp_registry.list_services(status="online")
    result: list[dict[str, Any]] = []
    for svc in services:
        policy = mcp_registry.get_role_policy(svc["service_id"], role_id)
        result.append({
            "service_id": svc["service_id"],
            "name": svc["name"],
            "service_type": svc["service_type"],
            "endpoint_url": svc["endpoint_url"],
            "enabled": policy["enabled"] if policy else False,
            "row_rules": policy.get("row_rules", []) if policy else [],
        })
    return {"role_id": role_id, "services": result}


# ── Agent Gateway: call MCP ─────────────────────────────────────────

class McpCallRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)


@router.post("/mcp/{service_id}")
async def call_mcp(service_id: str, body: McpCallRequest,
                    identity: dict | None = Depends(require_console_read)):
    """Agent calls a deployed MCP service."""
    import json as _json

    # ① Token → workspace_id
    identity = identity or {}
    workspace_id = str(identity.get("account_id") or "")
    scopes = identity.get("scopes") or []
    if not workspace_id:
        raise HTTPException(status_code=401, detail="无法解析 workspace_id")

    # ② service → manifest
    svc = mcp_registry.get_service(service_id)
    if svc is None or svc.get("status") != "online":
        raise HTTPException(status_code=404, detail="MCP service not found")
    manifest = _json.loads(svc.get("manifest") or "{}")

    # ③ 权限解析
    declared_dims = manifest.get("dimensions", [])
    permissions: dict[str, list[str]] = {}
    if declared_dims:
        policies = mcp_registry.list_policies_for_workspace(workspace_id)
        for p in policies:
            rules = p.get("row_rules", [])
            for rule in rules:
                where = rule.get("where", "")
                for dim in declared_dims:
                    if dim in where:
                        vals = _parse_dim_values(where)
                        if vals and vals[0] != "*":
                            permissions[dim] = vals

    # ④ Invoke with version injection
    from services.mcp_loader import invoke_mcp
    result = invoke_mcp(service_id, body.args, permissions)

    # Record usage
    mcp_registry.record_mcp_call(service_id)

    return result


def _parse_dim_values(where: str) -> list[str]:
    """Parse 'tenant_id IN (\\'a\\',\\'b\\')' or 'tenant_id = \\'*\\'' → list of values."""
    import re
    # Check for wildcard
    if where.strip().endswith("= '*'") or where.strip().endswith('= "*"'):
        return ["*"]
    # IN (...)
    m = re.search(r"IN\s*\(([^)]+)\)", where)
    if m:
        inner = m.group(1)
        vals = re.findall(r"'([^']*)'|\"([^\"]*)\"", inner)
        return [v[0] or v[1] for v in vals]
    # Single value
    m = re.search(r"=\s*'([^']*)'", where)
    if m:
        return [m.group(1)]
    return []


# ── Agent Discovery: tools list ──────────────────────────────────────

@router.get("/mcp/tools")
async def list_mcp_tools(identity: dict | None = Depends(require_console_read)):
    """Return MCP tools in Anthropic Tool Use format for the caller's workspace."""
    identity = identity or {}
    workspace_id = str(identity.get("account_id") or "")
    scopes = identity.get("scopes") or []
    if not workspace_id:
        raise HTTPException(status_code=401, detail="无法解析 workspace_id")

    import json as _json
    policies = mcp_registry.list_policies_for_workspace(workspace_id)
    tools: list[dict[str, Any]] = []
    seen: set[str] = set()

    for p in policies:
        sid = p["service_id"]
        if sid in seen:
            continue
        seen.add(sid)
        svc = mcp_registry.get_service(sid)
        if svc is None or svc.get("status") != "online":
            continue
        manifest = _json.loads(svc.get("manifest") or "{}")
        if not manifest:
            continue
        tool_name = sid.replace("-", "_")
        tools.append({
            "name": tool_name,
            "description": manifest.get("description", svc.get("name", "")),
            "input_schema": manifest.get("input", {"type": "object", "properties": {}}),
        })
    return {"tools": tools}


# ── Dimensions (admin) ──────────────────────────────────────────────

class DimensionCreate(BaseModel):
    dim_id: str = Field(default="", max_length=64)
    label: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=1, max_length=64)
    db_connection_id: str = Field(min_length=1, max_length=128)
    db_name: str = Field(default="", max_length=128)
    table_name: str = Field(min_length=1, max_length=128)
    column_name: str = Field(min_length=1, max_length=128)


class DimensionUpdate(BaseModel):
    label: str | None = None
    code: str | None = None
    db_name: str | None = None
    table_name: str | None = None
    column_name: str | None = None


@router.get("/dimensions", dependencies=[Depends(require_admin)])
async def list_dimensions():
    return {"dimensions": mcp_registry.list_dimensions()}


@router.post("/dimensions")
async def create_dimension(body: DimensionCreate, _admin=Depends(require_admin)):
    try:
        dim = mcp_registry.create_dimension(
            dim_id=body.dim_id, label=body.label,
            code=body.code,
            db_connection_id=body.db_connection_id,
            db_name=body.db_name,
            table_name=body.table_name, column_name=body.column_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _regenerate_permissions_safe()
    return {"dimension": dim}


@router.put("/dimensions/{dim_id}")
async def update_dimension(dim_id: str, body: DimensionUpdate, _admin=Depends(require_admin)):
    dim = mcp_registry.update_dimension(
        dim_id, label=body.label, code=body.code, db_name=body.db_name, table_name=body.table_name, column_name=body.column_name,
    )
    if dim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="dimension not found")
    _regenerate_permissions_safe()
    return {"dimension": dim}


@router.delete("/dimensions/{dim_id}")
async def delete_dimension(dim_id: str, _admin=Depends(require_admin)):
    if not mcp_registry.delete_dimension(dim_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="dimension not found")
    _regenerate_permissions_safe()
    return {"deleted": True}


@router.get("/dimensions/{dim_id}/values", dependencies=[Depends(require_admin)])
async def dimension_values(dim_id: str):
    values = mcp_registry.get_dimension_values(dim_id)
    return {"dim_id": dim_id, "values": values}


# ── Database introspection (for dimension form cascading) ─────────

@router.get("/databases/{connection_id}/names", dependencies=[Depends(require_admin)])
async def db_names(connection_id: str):
    try:
        names = mcp_registry.list_db_names(connection_id)
        return {"connection_id": connection_id, "names": names}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        import logging
        logging.getLogger("evotown").exception("Failed to list database names for %s", connection_id)
        raise HTTPException(status_code=500, detail="无法获取数据库列表")


@router.get("/databases/{connection_id}/tables", dependencies=[Depends(require_admin)])
async def db_tables(connection_id: str, database: str = ""):
    try:
        tables = mcp_registry.list_db_tables(connection_id, database=database)
        return {"connection_id": connection_id, "tables": tables}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        import logging
        logging.getLogger("evotown").exception("Failed to list tables for %s", connection_id)
        raise HTTPException(status_code=500, detail="无法连接数据库")


@router.get("/databases/{connection_id}/tables/{table:path}/columns", dependencies=[Depends(require_admin)])
async def db_table_columns(connection_id: str, table: str, database: str = ""):
    try:
        columns = mcp_registry.list_table_columns(connection_id, table, database=database)
        return {"connection_id": connection_id, "table": table, "columns": columns}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        import logging
        logging.getLogger("evotown").exception("Failed to list columns for %s.%s", connection_id, table)
        raise HTTPException(status_code=500, detail="无法获取表字段")


def _regenerate_permissions_safe():
    """Regenerate permissions.py, log errors instead of silently ignoring."""
    try:
        from services.mcp_codegen import regenerate_permissions
        regenerate_permissions()
    except Exception:
        import logging
        logging.getLogger("evotown").exception("regenerate_permissions failed")


# ── MCP Deploy (admin) ──────────────────────────────────────────────

class McpDeployRequest(BaseModel):
    service_id: str = Field(min_length=1, max_length=64)
    workspace_id: str = Field(min_length=1, max_length=128)


@router.post("/mcp-deploy")
async def deploy_mcp(body: McpDeployRequest, _admin=Depends(require_admin)):
    """Deploy MCP from workspace to mcp-services/ directory."""
    import re
    if not re.match(r'^[a-z0-9_-]+$', body.service_id):
        raise HTTPException(status_code=400, detail="service_id 仅允许 a-z 0-9 - _")

    ws = workspaces.get_workspace(body.workspace_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="workspace not found")

    import json as _json
    from pathlib import Path
    from infra import workspaces as _ws

    # Source: workspace .evotown/
    ws_root = _ws.resolve_workspace_path(ws)
    manifest_path = ws_root / ".evotown" / "mcp_manifest.json"
    handler_path = ws_root / ".evotown" / "mcp_handler.py"

    if not manifest_path.is_file():
        raise HTTPException(status_code=400, detail="manifest.json not found in workspace .evotown/")
    if not handler_path.is_file():
        raise HTTPException(status_code=400, detail="handler.py not found in workspace .evotown/")

    manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))

    # Validate dimensions exist in permissions.py
    declared_dims = manifest.get("dimensions", [])
    if declared_dims:
        try:
            from services.mcp_codegen import load_permissions_dims
            valid_dims = load_permissions_dims()
        except Exception:
            valid_dims = set()
        for dim in declared_dims:
            if dim not in valid_dims:
                raise HTTPException(
                    status_code=400,
                    detail=f"维度 '{dim}' 未注册，请先在维度管理中注册"
                )

    # Warn on open permissions
    warning = None
    if not declared_dims and not manifest.get("tables"):
        warning = "此 MCP 未声明任何权限维度，将为开放权限"

    # Copy to mcp-services/{service_id}/
    import shutil
    mcp_base = Path("/app/data/mcp-services")
    mcp_base.mkdir(parents=True, exist_ok=True)
    dest_dir = mcp_base / body.service_id
    if dest_dir.exists():
        shutil.rmtree(str(dest_dir))
    dest_dir.mkdir(parents=True)
    shutil.copy2(str(handler_path), str(dest_dir / "handler.py"))
    (dest_dir / "manifest.json").write_text(_json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # Copy guard.py template (empty, gateway handles auth directly)
    (dest_dir / "guard.py").write_text(
        f'# guard for {body.service_id}\n'
        f'SERVICE_ID = "{body.service_id}"\n',
        encoding="utf-8"
    )

    # Register to DB
    mcp_registry.register_service(
        service_id=body.service_id,
        name=manifest.get("name", body.service_id),
        description=manifest.get("description", ""),
    )
    # Update manifest + workspace_id
    conn = mcp_registry._ensure_conn()
    conn.execute(
        "UPDATE mcp_services SET manifest=?, workspace_id=?, status='online' WHERE service_id=?",
        (_json.dumps(manifest, ensure_ascii=False), body.workspace_id, body.service_id),
    )

    # Regenerate database.py
    try:
        from services.mcp_codegen import regenerate_database
        regenerate_database()
    except Exception:
        pass

    return {"deployed": True, "service_id": body.service_id, "warning": warning}


# ── System Functions (admin read-only, hardcoded data) ────────────────

@router.get("/mcp-functions", dependencies=[Depends(require_admin)])
async def list_system_functions(detail: bool = False):
    """List all system functions. With detail=true, include role/workspace assignments."""
    funcs = mcp_registry.list_system_functions()
    if detail:
        result: list[dict[str, Any]] = []
        for f in funcs:
            assignments = mcp_registry.list_function_assignments(f["func_id"])
            result.append({**f, "roles": assignments})
        return {"functions": result}
    return {"functions": funcs}


@router.get("/mcp-roles/{role_id}/functions", dependencies=[Depends(require_admin)])
async def get_role_functions(role_id: str):
    if mcp_registry.get_role(role_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    return {"role_id": role_id, "func_ids": mcp_registry.list_role_functions(role_id)}


@router.put("/mcp-roles/{role_id}/functions")
async def set_role_functions(role_id: str, body: RoleFunctionsUpdate, _admin=Depends(require_admin)):
    if mcp_registry.get_role(role_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    func_ids = mcp_registry.set_role_functions(role_id, body.func_ids)
    return {"role_id": role_id, "func_ids": func_ids}


@router.get("/workspaces/{workspace_id}/functions")
async def get_workspace_functions(workspace_id: str):
    """Return merged func_ids for a workspace (union across all its roles)."""
    func_ids = mcp_registry.list_workspace_functions(workspace_id)
    return {"workspace_id": workspace_id, "func_ids": func_ids}
