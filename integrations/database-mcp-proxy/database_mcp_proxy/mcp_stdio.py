#!/usr/bin/env python3
"""Stdio MCP server — exposes database tools for Cursor / OpenClaw MCP clients."""
from __future__ import annotations

import json
import os
from typing import Any

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:
    raise SystemExit("Install MCP stdio extras: pip install mcp") from exc

from .config import max_rows
from .drivers import list_tables, run_query
from .evotown import EvotownClient
from .sql_guard import sanitize_readonly_sql

mcp = FastMCP("evotown-database")


def _employee_key() -> str:
    key = os.environ.get("EVOTOWN_EMPLOYEE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Set EVOTOWN_EMPLOYEE_API_KEY for stdio MCP mode")
    return key


@mcp.tool()
async def list_database_connections() -> str:
    """List database connections the current employee may access (from Evotown ACL)."""
    client = EvotownClient()
    catalog = await client.fetch_catalog(_employee_key())
    return json.dumps({"connections": catalog}, ensure_ascii=False, indent=2)


@mcp.tool()
async def list_database_tables(connection_id: str) -> str:
    """List tables for a registered connection_id."""
    client = EvotownClient()
    await client.assert_access(_employee_key(), connection_id)
    resolved = await client.resolve_connection(connection_id)
    tables = list_tables(resolved)
    return json.dumps({"connection_id": connection_id, "tables": tables}, ensure_ascii=False, indent=2)


@mcp.tool()
async def query_readonly(connection_id: str, sql: str) -> str:
    """Run a read-only SELECT against a registered database. Write statements are rejected."""
    client = EvotownClient()
    await client.assert_access(_employee_key(), connection_id)
    safe_sql = sanitize_readonly_sql(sql, max_rows=max_rows())
    resolved = await client.resolve_connection(connection_id)
    result = run_query(resolved, safe_sql)
    payload: dict[str, Any] = {"connection_id": connection_id, "sql": safe_sql, **result}
    return json.dumps(payload, ensure_ascii=False, default=str)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
