from __future__ import annotations

from typing import Any

import httpx

from .config import evotown_base_url, evotown_mcp_token


class EvotownClient:
    def __init__(self, base_url: str | None = None, mcp_token: str | None = None) -> None:
        self.base_url = (base_url or evotown_base_url()).rstrip("/")
        self.mcp_token = (mcp_token or evotown_mcp_token()).strip()

    async def fetch_catalog(self, employee_api_key: str) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.base_url}/api/v1/databases/mcp/catalog",
                headers={"Authorization": f"Bearer {employee_api_key}"},
            )
            resp.raise_for_status()
            payload = resp.json()
            connections = payload.get("connections")
            return connections if isinstance(connections, list) else []

    async def resolve_connection(self, connection_id: str) -> dict[str, Any]:
        token = self.mcp_token
        if not token:
            raise RuntimeError("EVOTOWN_DATABASE_MCP_TOKEN is not configured")
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.base_url}/api/v1/databases/mcp/{connection_id}/resolve",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            connection = resp.json().get("connection")
            if not isinstance(connection, dict):
                raise RuntimeError("invalid resolve response from Evotown")
            return connection

    async def assert_access(self, employee_api_key: str, connection_id: str) -> dict[str, Any]:
        catalog = await self.fetch_catalog(employee_api_key)
        for item in catalog:
            if item.get("connection_id") == connection_id:
                return item
        raise PermissionError(f"no access to connection {connection_id}")
