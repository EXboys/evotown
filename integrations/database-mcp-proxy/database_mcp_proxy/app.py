from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from .config import max_rows
from .drivers import list_tables, run_query
from .evotown import EvotownClient
from .sql_guard import sanitize_readonly_sql

app = FastAPI(
    title="Evotown Database MCP Proxy",
    description="Executes read-only SQL against registered databases. Credentials come from Evotown; callers use employee API keys.",
    version="0.1.0",
)
_bearer = HTTPBearer(auto_error=False)


class QueryBody(BaseModel):
    connection_id: str = Field(min_length=1, max_length=128)
    sql: str = Field(min_length=1, max_length=8000)


def _extract_bearer(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer employee API key required")
    token = credentials.credentials.strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer employee API key required")
    return token


async def require_employee_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    return _extract_bearer(credentials)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "database-mcp-proxy"}


@app.get("/catalog")
async def catalog(employee_key: str = Depends(require_employee_key)) -> dict[str, Any]:
    client = EvotownClient()
    try:
        connections = await client.fetch_catalog(employee_key)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Evotown catalog failed: {exc}") from exc
    return {"connections": connections}


@app.get("/connections/{connection_id}/tables")
async def connection_tables(connection_id: str, employee_key: str = Depends(require_employee_key)) -> dict[str, Any]:
    client = EvotownClient()
    try:
        await client.assert_access(employee_key, connection_id)
        resolved = await client.resolve_connection(connection_id)
        tables = list_tables(resolved)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return {"connection_id": connection_id, "tables": tables}


@app.post("/query")
async def query_readonly(body: QueryBody, employee_key: str = Depends(require_employee_key)) -> dict[str, Any]:
    client = EvotownClient()
    try:
        grant = await client.assert_access(employee_key, body.connection_id)
        if grant.get("permission") not in {"read", "write", "admin"}:
            raise PermissionError("insufficient permission")
        safe_sql = sanitize_readonly_sql(body.sql, max_rows=max_rows())
        resolved = await client.resolve_connection(body.connection_id)
        result = run_query(resolved, safe_sql)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return {
        "connection_id": body.connection_id,
        "sql": safe_sql,
        "permission": grant.get("permission"),
        **result,
    }
