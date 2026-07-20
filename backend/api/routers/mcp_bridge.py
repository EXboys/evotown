"""
MCP Bridge — exposes agent's MCP tools as a single MCP HTTP server endpoint
for Claude Code native tool_use integration.

Claude Code → .mcp.json → POST bridge URL (JSON-RPC) → resolve agent → list/call tools
"""
from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import JSONResponse

from core import auth as auth_module
from infra import mcp_registry
from infra import agents as agents_store
from api.routers.mcp_services import _parse_dim_values

router = APIRouter(prefix="/api/v1/mcp/bridge", tags=["mcp-bridge"])


def _resolve_agent(agent_id: str, token: str) -> dict[str, Any] | None:
    """Validate agent_id + token and return agent record."""
    if not agent_id or not token:
        return None
    agent = agents_store.get_agent(agent_id)
    if not agent:
        return None
    key = agents_store.get_agent_key(agent_id)
    if not key or key != token:
        return None
    return agent


def _build_tools(agent_id: str) -> list[dict[str, Any]]:
    """Return MCP tools available to this agent (Anthropic Tool Use format)."""
    from services.mcp_loader import fetch_external_tools

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

        if svc.get("source") == "external":
            # ── External MCP: fetch tools from remote server ────────
            ext_tools = fetch_external_tools(sid)
            for et in ext_tools:
                tools.append({
                    "name": et["name"],
                    "description": et.get("description") or svc.get("name", ""),
                    "input_schema": et.get("input_schema") or {"type": "object", "properties": {}},
                })
            continue

        # ── Internal / System MCP: from DB ─────────────────────────
        try:
            raw_schema = json.loads(str(svc.get("input_schema") or "{}"))
        except (json.JSONDecodeError, TypeError):
            raw_schema = {}

        # Normalize to standard JSON Schema
        normalized: dict[str, Any] = {"type": "object", "properties": {}, "required": []}
        if isinstance(raw_schema, dict):
            has_standard = "properties" in raw_schema or "type" in raw_schema
            if has_standard:
                normalized = raw_schema
            else:
                for field_name, field_info in raw_schema.items():
                    if not isinstance(field_info, dict):
                        continue
                    prop: dict[str, Any] = {}
                    if "type" in field_info:
                        prop["type"] = field_info["type"]
                    if "desc" in field_info:
                        prop["description"] = field_info["desc"]
                    elif "description" in field_info:
                        prop["description"] = field_info["description"]
                    normalized["properties"][field_name] = prop
                    if field_info.get("required"):
                        normalized["required"].append(field_name)
                if not normalized["required"]:
                    del normalized["required"]
        if not normalized.get("properties"):
            normalized = {"type": "object", "properties": {}}

        tool_name = sid.replace("-", "_")
        tools.append({
            "name": tool_name,
            "description": svc.get("description") or svc.get("name", ""),
            "input_schema": normalized,
        })
    return tools


async def _handle_jsonrpc(request: Request, agent_id: str, token: str, run_id: str) -> dict[str, Any]:
    """Handle JSON-RPC request: tools/list, tools/call."""
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="invalid JSON")

    jsonrpc_id = body.get("id")
    method = body.get("method", "")
    params = body.get("params", {})

    if method == "tools/list":
        tools = _build_tools(agent_id)
        return {
            "jsonrpc": "2.0",
            "id": jsonrpc_id,
            "result": {"tools": tools},
        }

    if method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})

        # Resolve service_id from tool_name.
        # Internal MCP: tool_name == service_id (underscored)
        # External MCP: tool_name == {service_safe_id}__{original_tool}
        service_id = ""
        for p in mcp_registry.list_policies_for_agent(agent_id):
            sid = p["service_id"]
            safe_sid = sid.replace("-", "_")
            # Exact match (internal/system legacy)
            if safe_sid == tool_name:
                service_id = sid
                break
            # Prefix match (external MCP multi-tool)
            prefix = safe_sid + "__"
            if tool_name.startswith(prefix):
                service_id = sid
                break

        if not service_id:
            return {
                "jsonrpc": "2.0",
                "id": jsonrpc_id,
                "error": {"code": -32602, "message": f"Tool not found: {tool_name}"},
            }

        from services.mcp_loader import invoke_mcp
        svc = mcp_registry.get_service(service_id)

        # Resolve dimension permissions (shared logic)
        from infra.mcp_registry import resolve_mcp_permissions
        resolved = resolve_mcp_permissions(agent_id, service_id)
        permissions = resolved["permissions"]

        # Safety: deny if service has dimensions but agent has no rules
        if resolved["has_dimensions"] and not resolved["has_rules"]:
            err = json.dumps({"ok": False, "error": "未配置数据权限，请联系管理员分配行规则"}, ensure_ascii=False)
            return {
                "jsonrpc": "2.0",
                "id": jsonrpc_id,
                "result": {"content": [{"type": "text", "text": err}]},
            }

        # Resolve account_id from run_id
        account_id_val = ""
        if run_id:
            try:
                from infra import claude_agent_runs
                run_rec = claude_agent_runs.get_run(run_id)
                if run_rec:
                    account_id_val = str(run_rec.get("account_id") or "")
            except Exception:
                pass
        if account_id_val:
            permissions["account"] = account_id_val

        result = invoke_mcp(service_id, arguments, permissions, tool_name=tool_name)

        handler_ok = result.get("ok") and (result.get("data") or {}).get("ok", True)
        mcp_registry.record_mcp_call(
            service_id,
            run_id=run_id,
            agent_id=agent_id,
            account_id=account_id_val,
            args=json.dumps(arguments, ensure_ascii=False),
            status="success" if handler_ok else "error",
            result=json.dumps(result, ensure_ascii=False, default=str),
        )

        result_text = json.dumps(result, ensure_ascii=False, indent=2, default=str)
        return {
            "jsonrpc": "2.0",
            "id": jsonrpc_id,
            "result": {"content": [{"type": "text", "text": result_text}]},
        }

    return {
        "jsonrpc": "2.0",
        "id": jsonrpc_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


@router.api_route("", methods=["GET", "POST"])
@router.api_route("/tools/call", methods=["POST"])
async def mcp_bridge(
    request: Request,
    agent_id: str = Query(""),
    token: str = Query(""),
    run_id: str = Query(""),
):
    agent = _resolve_agent(agent_id, token)
    if not agent:
        raise HTTPException(status_code=401, detail="invalid agent_id or token")

    if request.method == "GET":
        return JSONResponse(content={})

    return await _handle_jsonrpc(request, agent_id, token, run_id)
