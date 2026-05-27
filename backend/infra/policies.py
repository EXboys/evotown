"""Enterprise policy store — pull-based policy definitions for connectors."""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"
_DATA_DIR = Path(os.environ.get("EVOTOWN_DATA_DIR", _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"))

_conn: sqlite3.Connection | None = None

_DEFAULT_POLICIES: list[dict[str, Any]] = [
    {
        "policy_id": "model-allowlist",
        "category": "model",
        "name": "模型白名单",
        "description": "仅允许列出的模型提供商与模型名。",
        "enabled": True,
        "rules": {
            "allow_providers": ["openai", "anthropic", "azure", "google"],
            "allow_models": [],
            "deny_models": [],
        },
    },
    {
        "policy_id": "tool-allowlist",
        "category": "tool",
        "name": "工具与 MCP 白名单",
        "description": "限制 Agent 可调用的工具与 MCP 服务。",
        "enabled": True,
        "rules": {
            "allow_tools": [],
            "deny_tools": ["shell_rm_rf", "raw_sql_exec"],
            "require_approval_tools": ["filesystem_write", "network_egress"],
        },
    },
    {
        "policy_id": "workspace-paths",
        "category": "workspace",
        "name": "工作区路径",
        "description": "限制文件读写仅在工作区内；拦截敏感系统路径。",
        "enabled": True,
        "rules": {
            "workspace_roots": ["~/.evotown/workspace", "~/.openclaw/workspace"],
            "deny_path_patterns": [
                "**/.ssh/**",
                "**/.aws/**",
                "**/.gnupg/**",
                "/etc/**",
                "/System/**",
                "/private/**",
            ],
            "require_approval_write_patterns": [],
        },
    },
    {
        "policy_id": "network-domains",
        "category": "network",
        "name": "外网域名规则",
        "description": "允许或阻断的外部网络域名。",
        "enabled": True,
        "rules": {
            "allow_domains": ["*.company.internal", "github.com", "api.openai.com"],
            "deny_domains": [],
            "require_approval_domains": [],
        },
    },
    {
        "policy_id": "artifact-limits",
        "category": "artifact",
        "name": "产物上传限制",
        "description": "artifact 大小与文件类型限制。",
        "enabled": True,
        "rules": {
            "max_bytes": 52_428_800,
            "allowed_extensions": [".txt", ".md", ".json", ".zip", ".pdf", ".png"],
            "blocked_extensions": [".exe", ".dll", ".sh"],
        },
    },
    {
        "policy_id": "secret-redaction",
        "category": "security",
        "name": "密钥脱敏",
        "description": "日志与上报 context 中的密钥脱敏规则。",
        "enabled": True,
        "rules": {
            "redact_patterns": ["api_key", "bearer", "sk-", "evk_", "evi_"],
            "block_secret_in_artifacts": True,
        },
    },
]


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DATA_DIR / "policies.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS policies (
            policy_id   TEXT PRIMARY KEY,
            category    TEXT NOT NULL,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            enabled     INTEGER NOT NULL DEFAULT 1,
            rules       TEXT NOT NULL DEFAULT '{}',
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )
    _seed_defaults(conn)
    _conn = conn
    return conn


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _policy_from_row(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["enabled"] = bool(item.get("enabled", 1))
    item["rules"] = _json_loads(str(item.get("rules") or "{}"), {})
    return item


def _seed_defaults(conn: sqlite3.Connection) -> None:
    for entry in _DEFAULT_POLICIES:
        conn.execute(
            """
            INSERT OR IGNORE INTO policies (policy_id, category, name, description, enabled, rules)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                entry["policy_id"],
                entry["category"],
                entry["name"],
                entry["description"],
                1 if entry.get("enabled", True) else 0,
                _json_dumps(entry.get("rules") or {}),
            ),
        )


def list_policies(*, enabled_only: bool = False) -> dict[str, Any]:
    conn = _ensure_conn()
    where = "WHERE enabled=1" if enabled_only else ""
    rows = conn.execute(f"SELECT * FROM policies {where} ORDER BY category, policy_id").fetchall()
    policies = [_policy_from_row(row) for row in rows]
    updated = conn.execute("SELECT MAX(updated_at) AS ts FROM policies").fetchone()
    return {
        "version": 1,
        "updated_at": updated["ts"] if updated and updated["ts"] else datetime.now(timezone.utc).isoformat(),
        "policies": policies,
    }


def get_policy(policy_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute("SELECT * FROM policies WHERE policy_id=?", (policy_id,)).fetchone()
    return _policy_from_row(row) if row else None


def upsert_policy(entry: dict[str, Any]) -> dict[str, Any]:
    policy_id = str(entry.get("policy_id") or "").strip()
    if not policy_id:
        raise ValueError("policy_id is required")
    conn = _ensure_conn()
    conn.execute(
        """
        INSERT INTO policies (policy_id, category, name, description, enabled, rules, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(policy_id) DO UPDATE SET
            category=excluded.category,
            name=excluded.name,
            description=excluded.description,
            enabled=excluded.enabled,
            rules=excluded.rules,
            updated_at=datetime('now')
        """,
        (
            policy_id,
            str(entry.get("category") or "custom"),
            str(entry.get("name") or policy_id),
            str(entry.get("description") or ""),
            1 if entry.get("enabled", True) else 0,
            _json_dumps(entry.get("rules") or {}),
        ),
    )
    result = get_policy(policy_id)
    if result is None:
        raise RuntimeError(f"failed to upsert policy {policy_id}")
    return result


def replace_policies(policies: list[dict[str, Any]]) -> dict[str, Any]:
    conn = _ensure_conn()
    conn.execute("DELETE FROM policies")
    for entry in policies:
        upsert_policy(entry)
    return list_policies()
