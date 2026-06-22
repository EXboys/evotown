"""MCP service management API — admin panel endpoints."""
from __future__ import annotations

from typing import Any
import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from core.auth import require_admin, require_console_read, require_mcp_call
from infra import mcp_registry, agents

router = APIRouter(prefix="/api/v1", tags=["mcp"])


class McpPolicyUpdate(BaseModel):
    enabled: bool = True
    row_rules: list[dict[str, Any]] = Field(default_factory=list)


class BatchPolicyItem(BaseModel):
    agent_id: str
    enabled: bool = True
    row_rules: list[dict[str, Any]] = Field(default_factory=list)


class BatchPolicyUpdate(BaseModel):
    policies: list[BatchPolicyItem] = Field(default_factory=list)


# ── MCP Services (admin) ───────────────────────────────────────────────

class McpServiceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = ""
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
        svc["bound_agents"] = mcp_registry.count_service_policies(svc["service_id"])
        svc["calls_24h"] = mcp_registry.count_mcp_calls(svc["service_id"])
    return {"services": services, "stats": mcp_registry.registry_stats()}


@router.post("/mcp-services")
async def create_mcp_service(body: McpServiceCreate, _admin=Depends(require_admin)):
    svc = mcp_registry.register_service(
        name=body.name,
        description=body.description,
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
        "bound_agents": mcp_registry.count_service_policies(service_id),
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
        if not agents.get_agent(item.agent_id):
            continue
        policy = mcp_registry.set_policy(
            service_id,
            item.agent_id,
            enabled=item.enabled,
            row_rules=item.row_rules,
        )
        created.append(policy)
    return {"service_id": service_id, "policies": created}


@router.delete("/mcp-services/{service_id}/policies/{agent_id}")
async def delete_service_policy(service_id: str, agent_id: str, _admin=Depends(require_admin)):
    deleted = mcp_registry.delete_policy(service_id, agent_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="policy not found")
    return {"deleted": True}


# ── Agent runtime (no admin required) ──────────────────────────────────

@router.get("/agents/{agent_id}/mcp")
async def get_workspace_mcp(agent_id: str):
    """Called by Agent runtime to get MCP connections for a workspace."""
    workspace = agents.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    connections = mcp_registry.list_policies_for_agent(agent_id)
    return {"agent_id": agent_id, "mcp": connections}


# ── Role CRUD (admin) ───────────────────────────────────────────────────

class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = ""


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class RoleMembersUpdate(BaseModel):
    agent_ids: list[str] = Field(default_factory=list)


class RolePolicyBatchItem(BaseModel):
    role_id: str
    enabled: bool = True
    row_rules: list[dict[str, Any]] = Field(default_factory=list)


class SingleRolePolicyUpdate(BaseModel):
    enabled: bool = True


class RoleDimensionUpdate(BaseModel):
    dim_values: list[str] = Field(default_factory=list)


class RoleDimensionsBatchUpdate(BaseModel):
    dimensions: list[dict[str, Any]] = Field(default_factory=list)


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
    members = mcp_registry.set_role_members(role_id, body.agent_ids)
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


@router.put("/mcp-services/{service_id}/role-policies/{role_id}")
async def set_service_role_policy(service_id: str, role_id: str, body: SingleRolePolicyUpdate, _admin=Depends(require_admin)):
    """Enable or disable a single role's MCP policy for this service."""
    if mcp_registry.get_service(service_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    if mcp_registry.get_role(role_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    policy = mcp_registry.set_role_policy(service_id, role_id, enabled=body.enabled)
    return {"service_id": service_id, "role_id": role_id, "policy": policy}


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
            "endpoint_url": svc["endpoint_url"],
            "enabled": policy["enabled"] if policy else False,
            "row_rules": policy.get("row_rules", []) if policy else [],
        })
    return {"role_id": role_id, "services": result}


# ── Role dimensions (REQ-015) ──────────────────────────────────────

@router.get("/mcp-roles/{role_id}/dimensions", dependencies=[Depends(require_admin)])
async def get_role_dimensions(role_id: str):
    """Get all dimension bindings for a role, enriched with metadata."""
    if mcp_registry.get_role(role_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    dims = mcp_registry.get_role_dimensions(role_id)
    # Also include unconfigured dimensions (all registered dims not yet bound)
    all_dims = mcp_registry.list_dimensions()
    bound_ids = {d["dim_id"] for d in dims}
    for d in all_dims:
        if d["dim_id"] not in bound_ids:
            dims.append({
                "dim_id": d["dim_id"],
                "label": d["label"],
                "code": d.get("code", ""),
                "db_connection_id": d["db_connection_id"],
                "table_name": d["table_name"],
                "column_name": d["column_name"],
                "dim_values": [],
                "updated_at": "",
            })
    return {"role_id": role_id, "dimensions": dims}


@router.put("/mcp-roles/{role_id}/dimensions/{dim_id}")
async def set_role_dimension(role_id: str, dim_id: str, body: RoleDimensionUpdate, _admin=Depends(require_admin)):
    """Set or update a single role-dimension binding. dim_values=["*"] means full access."""
    if mcp_registry.get_role(role_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    if mcp_registry.get_dimension(dim_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="dimension not found")
    result = mcp_registry.set_role_dimension(role_id, dim_id, body.dim_values)
    return {"role_id": role_id, "dim_id": dim_id, "dim_values": result["dim_values"]}


@router.put("/mcp-roles/{role_id}/dimensions")
async def set_role_dimensions_batch(role_id: str, body: RoleDimensionsBatchUpdate, _admin=Depends(require_admin)):
    """Replace all dimension bindings for a role."""
    if mcp_registry.get_role(role_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    count = mcp_registry.set_role_dimensions_batch(role_id, body.dimensions)
    return {"role_id": role_id, "dimensions_set": count}


# ── Agent Gateway: call MCP ─────────────────────────────────────────

class McpCallRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)


@router.post("/mcp/{service_id}")
async def call_mcp(service_id: str, body: McpCallRequest,
                    run_id: str = Query(""),
                    identity: dict | None = Depends(require_mcp_call)):
    """Agent calls a deployed MCP service."""
    import json as _json

    # ① Token → agent_id
    identity = identity or {}
    agent_id = str(identity.get("account_id") or "")
    scopes = identity.get("scopes") or []
    if not agent_id:
        raise HTTPException(status_code=401, detail="无法解析 agent_id")

    # ② service → dimensions
    svc = mcp_registry.get_service(service_id)
    if svc is None or svc.get("status") != "online":
        raise HTTPException(status_code=404, detail="MCP service not found")
    try:
        declared_dims = json.loads(str(svc.get("dimensions") or "[]"))
    except (json.JSONDecodeError, TypeError):
        declared_dims = []
    permissions: dict[str, list[str]] = {}
    if declared_dims:
        policies = mcp_registry.list_policies_for_agent(agent_id)
        for p in policies:
            rules = p.get("row_rules", [])
            for rule in rules:
                where = rule.get("where", "")
                for dim in declared_dims:
                    if dim in where:
                        vals = _parse_dim_values(where)
                        if vals and vals[0] != "*":
                            permissions[dim] = vals

    # ③ Resolve run_id → account_id for audit
    account_id = ""
    if run_id:
        from infra import claude_agent_runs
        run = claude_agent_runs.get_run(run_id)
        if run:
            account_id = str(run.get("account_id") or "")

    # ④ Invoke with version injection
    from services.mcp_loader import invoke_mcp
    if agent_id:
        permissions["agent_id"] = agent_id
    if account_id:
        permissions["account_id"] = account_id
    result = invoke_mcp(service_id, body.args, permissions)

    # ⑤ Record audit
    args_summary = json.dumps(body.args, ensure_ascii=False)
    handler_ok = result.get("ok") and (result.get("data") or {}).get("ok", True)
    mcp_registry.record_mcp_call(
        service_id,
        run_id=run_id,
        agent_id=agent_id,
        account_id=account_id,
        args=args_summary,
        status="success" if handler_ok else "error",
        result=json.dumps(result, ensure_ascii=False),
    )

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
async def list_mcp_tools(identity: dict | None = Depends(require_mcp_call)):
    """Return MCP tools in Anthropic Tool Use format for the caller's workspace."""
    identity = identity or {}
    agent_id = str(identity.get("account_id") or "")
    scopes = identity.get("scopes") or []
    if not agent_id:
        raise HTTPException(status_code=401, detail="无法解析 agent_id")

    import json as _json
    policies = mcp_registry.list_policies_for_agent(agent_id)
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
        try:
            input_schema = json.loads(str(svc.get("input_schema") or "{}"))
        except (json.JSONDecodeError, TypeError):
            input_schema = {}
        if not input_schema:
            input_schema = {"type": "object", "properties": {}}
        tool_name = sid.replace("-", "_")
        tools.append({
            "name": tool_name,
            "description": svc.get("description") or svc.get("name", ""),
            "input_schema": input_schema,
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
    agent_id: str = Field(min_length=1, max_length=128)


@router.post("/mcp-deploy")
async def deploy_mcp(body: McpDeployRequest, _admin=Depends(require_admin)):
    """Deploy MCP from workspace to mcp-services/ directory."""
    import re
    if not re.match(r'^[a-z0-9_-]+$', body.service_id):
        raise HTTPException(status_code=400, detail="service_id 仅允许 a-z 0-9 - _")

    ws = agents.get_agent(body.agent_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="agent not found")

    import json as _json
    from pathlib import Path
    from infra import agents as _ws

    # Source: workspace .evotown/
    ws_root = _ws.resolve_agent_path(ws)
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
    # Update manifest + agent_id
    conn = mcp_registry._ensure_conn()
    conn.execute(
        "UPDATE mcp_services SET manifest=?, agent_id=?, status='online' WHERE service_id=?",
        (_json.dumps(manifest, ensure_ascii=False), body.agent_id, body.service_id),
    )

    # Regenerate database.py
    try:
        from services.mcp_codegen import regenerate_database
        regenerate_database()
    except Exception:
        pass

    return {"deployed": True, "service_id": body.service_id, "warning": warning}


# ── MCP Review (admin) ────────────────────────────────────────────────

class McpReviewRequest(BaseModel):
    review_comment: str = ""


@router.get("/mcp-services/{service_id}/versions", dependencies=[Depends(require_admin)])
async def list_service_versions_endpoint(service_id: str):
    """List all version records for an MCP service."""
    if mcp_registry.get_service(service_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    versions = mcp_registry.list_service_versions(service_id)
    return {"service_id": service_id, "versions": versions}


@router.get("/mcp-services/{service_id}/calls", dependencies=[Depends(require_admin)])
async def list_mcp_calls(service_id: str, limit: int = 50, offset: int = 0):
    """List recent MCP call records with pagination."""
    if mcp_registry.get_service(service_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")
    calls = mcp_registry.list_mcp_calls(service_id, limit=limit, offset=offset)
    total = mcp_registry.count_mcp_calls(service_id)
    return {"service_id": service_id, "calls": calls, "total": total, "limit": limit, "offset": offset}


@router.post("/mcp-services/{service_id}/approve", dependencies=[Depends(require_admin)])
async def approve_mcp_service(service_id: str, body: McpReviewRequest = McpReviewRequest()):
    """Approve pending version → copy handler to production + set online."""
    import shutil
    from pathlib import Path as _Path

    svc = mcp_registry.get_service(service_id)
    if svc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")

    mcp_path = svc.get("mcp_path", "")
    if not mcp_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mcp_path 为空，无法部署")

    pending_ver = mcp_registry.get_pending_version(service_id)
    is_update = pending_ver is not None

    # Version info: from pending version record if exists, else from service row
    version = pending_ver.get("version", "") if is_update else svc.get("version", "")
    dimensions = pending_ver.get("snapshot_dimensions", "[]") if is_update else svc.get("dimensions", "[]")
    tables = pending_ver.get("snapshot_tables", "[]") if is_update else svc.get("tables", "[]")
    input_schema = pending_ver.get("snapshot_input_schema", "{}") if is_update else svc.get("input_schema", "{}")
    output_schema = pending_ver.get("snapshot_output_schema", "{}") if is_update else svc.get("output_schema", "{}")

    # ── Copy handler.py from dev to prod ──────────────────────────
    dev_handler = _Path("/app/data/mcp-dev") / mcp_path.strip("/") / "handler.py"
    prod_dir = _Path("/app/data/mcp-services") / mcp_path.strip("/")

    if not dev_handler.is_file():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                           detail=f"handler.py not found: {dev_handler}")

    prod_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(dev_handler), str(prod_dir / "handler.py"))

    dev_manifest = _Path("/app/data/mcp-dev") / mcp_path.strip("/") / "manifest.json"
    if dev_manifest.is_file():
        shutil.copy2(str(dev_manifest), str(prod_dir / "manifest.json"))

    # ── Update service record to online ───────────────────────────
    conn = mcp_registry._ensure_conn()
    conn.execute(
        """UPDATE mcp_services SET status='online',
           version=?, dimensions=?, tables=?, input_schema=?, output_schema=?,
           updated_at=datetime('now')
           WHERE service_id=?""",
        (version, dimensions, tables, input_schema, output_schema, service_id),
    )

    # ── Mark version as approved (if exists) ──────────────────────
    if is_update:
        mcp_registry.update_service_version_status(
            pending_ver["version_id"], "approved",
            reviewed_by="admin",
            review_comment=body.review_comment or "",
        )

    # ── Clear mcp_loader cache ────────────────────────────────────
    from services.mcp_loader import clear_handler_cache
    clear_handler_cache(service_id)

    return {"approved": True, "service_id": service_id,
            "version_id": pending_ver.get("version_id", "") if is_update else "",
            "version": version}


@router.post("/mcp-services/{service_id}/reject", dependencies=[Depends(require_admin)])
async def reject_mcp_service(service_id: str, body: McpReviewRequest):
    """Reject pending version."""
    svc = mcp_registry.get_service(service_id)
    if svc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP service not found")

    pending = mcp_registry.get_pending_version(service_id)
    if pending is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="没有待审核的版本")

    mcp_registry.update_service_version_status(
        pending["version_id"], "rejected",
        reviewed_by="admin",
        review_comment=body.review_comment or "",
    )

    # If this was a first-time submission (service still pending), set service back to offline
    if svc.get("status") == "pending":
        conn = mcp_registry._ensure_conn()
        conn.execute(
            "UPDATE mcp_services SET status='offline', updated_at=datetime('now') WHERE service_id=?",
            (service_id,),
        )

    return {"rejected": True, "service_id": service_id, "version_id": pending["version_id"]}

