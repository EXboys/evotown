"""Enterprise database connection registry — metadata + ACL only (MCP executes queries)."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from core.auth import has_console_write, require_admin, require_console_read, session_from_api_key
from domain.models import (
    DatabaseAccessGrantCreate,
    DatabaseConnectionCreate,
    DatabaseConnectionTestConfig,
    DatabaseConnectionUpdate,
)
from infra import database_connect, database_registry

router = APIRouter(prefix="/api/v1/databases", tags=["databases"])
_bearer = HTTPBearer(auto_error=False)
_admin_header = APIKeyHeader(name="X-Admin-Token", auto_error=False)


def _mcp_service_token() -> str:
    return os.environ.get("EVOTOWN_DATABASE_MCP_TOKEN", "").strip()


async def require_mcp_or_admin(
    key: str | None = Security(_admin_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    """MCP proxy resolves credentials with EVOTOWN_DATABASE_MCP_TOKEN or admin/console write."""
    service = _mcp_service_token()
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials.strip()
        if service and token == service:
            return
        session = session_from_api_key(token)
        if session is not None and has_console_write(session.get("scopes") or []):
            return
    admin_token = os.environ.get("ADMIN_TOKEN", "").strip()
    if admin_token and key and key == admin_token:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="MCP service token, X-Admin-Token, or console.write bearer required.",
    )


@router.get("/stats")
async def database_stats(_session: dict | None = Depends(require_console_read)):
    del _session
    return database_registry.registry_stats()


@router.get("/accessible")
async def list_accessible_databases(
    session: dict | None = Depends(require_console_read),
):
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    if session.get("source") == "admin_token" or "*" in (session.get("scopes") or []):
        connections = database_registry.list_connections(status="active")
        return {
            "connections": [
                {
                    "connection_id": item["connection_id"],
                    "name": item["name"],
                    "db_type": item["db_type"],
                    "access_mode": item["access_mode"],
                    "permission": "admin",
                    "team_id": item["team_id"],
                }
                for item in connections
            ]
        }
    return {"connections": database_registry.list_accessible_connections(session)}


@router.get("/mcp/catalog")
async def mcp_database_catalog(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
):
    """Runtime / skill MCP layer: list databases the caller may use (no credentials)."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bearer API key required")
    session = session_from_api_key(credentials.credentials)
    if session is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid API key")
    return {"connections": database_registry.list_accessible_connections(session)}


@router.get("/mcp/{connection_id}/resolve", dependencies=[Depends(require_mcp_or_admin)])
async def mcp_resolve_connection(connection_id: str):
    """MCP proxy only — returns full connection config including credentials."""
    item = database_registry.get_connection(connection_id, include_secrets=True)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="connection not found")
    if item.get("access_mode") != "mcp_only":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unsupported access_mode")
    return {"connection": item}


@router.get("/manage")
async def list_managed_connections(
    status_filter: str | None = None,
    limit: int = 100,
    _session: dict | None = Depends(require_console_read),
):
    del _session
    return {"connections": database_registry.list_connections(status=status_filter, limit=limit)}


@router.get("/manage/{connection_id}")
async def get_managed_connection(connection_id: str, _session: dict | None = Depends(require_console_read)):
    del _session
    item = database_registry.get_connection(connection_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="connection not found")
    grants = database_registry.list_grants(connection_id=connection_id)
    return {"connection": item, "grants": grants}


@router.post("", dependencies=[Depends(require_admin)])
async def create_database_connection(body: DatabaseConnectionCreate):
    cid = (body.connection_id or "").strip()
    if cid and database_registry.get_connection(cid):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="connection_id already exists")
    connection = database_registry.create_connection(body)
    # 自动生成 database.py
    try:
        from services.mcp_codegen import regenerate_database
        regenerate_database()
    except Exception:
        pass
    return {"created": True, "connection": connection}


@router.put("/{connection_id}", dependencies=[Depends(require_admin)])
async def update_database_connection(connection_id: str, body: DatabaseConnectionUpdate):
    connection = database_registry.update_connection(connection_id, body)
    if connection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="connection not found")
    try:
        from services.mcp_codegen import regenerate_database
        regenerate_database()
    except Exception:
        pass
    return {"updated": True, "connection": connection}


@router.delete("/{connection_id}", dependencies=[Depends(require_admin)])
async def delete_database_connection(connection_id: str):
    if not database_registry.delete_connection(connection_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="connection not found")
    try:
        from services.mcp_codegen import regenerate_database
        regenerate_database()
    except Exception:
        pass
    return {"deleted": True}


@router.get("/grants/manage")
async def list_all_grants(
    connection_id: str | None = None,
    limit: int = 500,
    _session: dict | None = Depends(require_console_read),
):
    del _session
    return {"grants": database_registry.list_grants(connection_id=connection_id, limit=limit)}


@router.post("/grants", dependencies=[Depends(require_admin)])
async def create_database_grant(body: DatabaseAccessGrantCreate):
    try:
        grant = database_registry.create_grant(body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"created": True, "grant": grant}


@router.delete("/grants/{grant_id}", dependencies=[Depends(require_admin)])
async def delete_database_grant(grant_id: str):
    if not database_registry.delete_grant(grant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="grant not found")
    return {"deleted": True}


def _build_test_result(connection: dict) -> dict:
    db_result = database_connect.test_database_connection(connection)
    ok = db_result.get("ok") is True
    return {"ok": ok, "database": db_result}


@router.post("/test-config", dependencies=[Depends(require_admin)])
async def test_database_config(body: DatabaseConnectionTestConfig):
    """Admin: test draft connection settings before save."""
    connection = {
        "db_type": body.db_type,
        "config": body.config,
    }
    return _build_test_result(connection)


@router.post("/{connection_id}/test", dependencies=[Depends(require_admin)])
async def test_database_connection(connection_id: str):
    """Admin: test a registered database connection (+ optional MCP proxy health)."""
    item = database_registry.get_connection(connection_id, include_secrets=True)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="connection not found")
    return _build_test_result(item)
