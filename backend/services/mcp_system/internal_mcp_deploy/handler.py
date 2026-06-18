"""System MCP: internal_mcp_deploy — submit internal MCP for review.

Agent calls:
    mcp_call("internal_mcp_deploy", {"category": "shop", "name": "platform_order"})

Flow:
    1. Build mcp_path = /{category}/{name}, service_id = {category}_{name}
    2. Read manifest.json from /app/data/mcp-dev/{mcp_path}/
    3. Parse name/description/dimensions/version/tables/schemas
    4. Check if service exists → first-time or update
    5. Check pending version → reject if already pending
    6. First-time: INSERT mcp_services (status=pending)
       Update: INSERT mcp_service_versions (status=pending)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

MCP_DEV_DIR = Path(os.environ.get("MCP_DEV_DIR", "/app/data/mcp-dev"))


def process(args: dict, permissions: dict) -> dict[str, Any]:
    """Handle internal_mcp_deploy request.

    args: {"category": str, "name": str}
    permissions: agent/account context injected by gateway
    """
    category = (args.get("category", "") or "").strip().strip("/")
    name = (args.get("name", "") or "").strip().strip("/")

    if not category or not name:
        return {"ok": False, "data": None, "error": "category 和 name 不能为空"}

    mcp_path = f"/{category}/{name}"
    service_id = f"{category}_{name}"

    # ── Read manifest.json from dev directory ──────────────────────
    manifest_file = MCP_DEV_DIR / category / name / "manifest.json"
    if not manifest_file.is_file():
        return {
            "ok": False,
            "data": None,
            "error": f"manifest.json 不存在: {manifest_file}",
        }

    try:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {
            "ok": False,
            "data": None,
            "error": f"manifest.json 解析失败: {exc}",
        }

    manifest_name = manifest.get("name", name)
    description = manifest.get("description", "")
    version = str(manifest.get("version", "1.0.0"))
    dimensions = manifest.get("dimensions", [])
    tables = manifest.get("tables", [])
    input_schema = manifest.get("input", {})
    output_schema = manifest.get("output", {})

    # ── Lazy import to avoid startup circularity ───────────────────
    from infra.mcp_registry import (
        SOURCE_INTERNAL,
        STATUS_PENDING,
        get_service,
        get_pending_version,
        register_service,
        create_service_version,
    )

    agent_id = permissions.get("agent_id", "")
    account = permissions.get("account", "")

    existing = get_service(service_id)

    if existing is None:
        # ── First-time submission ──────────────────────────────────
        register_service(
            service_id=service_id,
            name=manifest_name,
            description=description,
            source=SOURCE_INTERNAL,
            mcp_path=mcp_path,
            category=category,
            version=version,
            dimensions=dimensions,
            tables=tables,
            input_schema=input_schema,
            output_schema=output_schema,
            status=STATUS_PENDING,
        )
        return {
            "ok": True,
            "data": {
                "service_id": service_id,
                "mcp_path": mcp_path,
                "version": version,
                "action": "created",
                "message": f"MCP 服务 '{manifest_name}' 已提交审核",
            },
        }

    # ── Update submission: check for pending version ───────────────
    pending = get_pending_version(service_id)
    if pending:
        return {
            "ok": False,
            "data": None,
            "error": f"版本 {pending.get('version', '?')} 正在审核中，请等待审核完成后再提交",
        }

    # ── Check if source has changed (e.g. from external to internal) ──
    if existing.get("source") != SOURCE_INTERNAL:
        return {
            "ok": False,
            "data": None,
            "error": f"该 MCP 服务来源为 '{existing.get('source')}'，不允许通过此方式更新",
        }

    # ── Create new version record ─────────────────────────────────
    ver_record = create_service_version(
        service_id=service_id,
        version=version,
        version_notes=manifest.get("changelog", ""),
        dimensions=dimensions,
        tables=tables,
        input_schema=input_schema,
        output_schema=output_schema,
        submitted_by_agent=agent_id,
        submitted_by_account=account,
    )

    return {
        "ok": True,
        "data": {
            "service_id": service_id,
            "mcp_path": mcp_path,
            "version": version,
            "version_id": ver_record.get("version_id", ""),
            "action": "updated",
            "message": f"MCP 服务 '{manifest_name}' 版本 {version} 已提交审核",
        },
    }
