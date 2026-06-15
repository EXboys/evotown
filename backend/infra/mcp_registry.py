"""MCP service registry — evotown managed MCP service catalog and workspace policies.

MCP services are registered by backend operators (not by frontend).
Each workspace can be granted access with optional row-level rules.
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"

_conn: sqlite3.Connection | None = None

SERVICE_TYPE_DATABASE = "database"
SERVICE_TYPE_API = "api"
SERVICE_TYPE_FILE = "file"

STATUS_ONLINE = "online"
STATUS_OFFLINE = "offline"
STATUS_ERROR = "error"

SOURCE_MANUAL = "manual"
SOURCE_AGENT = "agent"


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "mcp_registry.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS mcp_services (
            service_id     TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT NOT NULL DEFAULT '',
            service_type   TEXT NOT NULL DEFAULT 'database',
            endpoint_url   TEXT NOT NULL DEFAULT '',
            db_type        TEXT NOT NULL DEFAULT '',
            status         TEXT NOT NULL DEFAULT 'online',
            source         TEXT NOT NULL DEFAULT 'manual',
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_services_status ON mcp_services(status);
        CREATE INDEX IF NOT EXISTS idx_mcp_services_type ON mcp_services(service_type);

        CREATE TABLE IF NOT EXISTS mcp_workspace_policies (
            policy_id      TEXT PRIMARY KEY,
            service_id     TEXT NOT NULL,
            workspace_id   TEXT NOT NULL,
            enabled        INTEGER NOT NULL DEFAULT 1,
            row_rules      TEXT NOT NULL DEFAULT '[]',
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(service_id, workspace_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_policies_service ON mcp_workspace_policies(service_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_policies_workspace ON mcp_workspace_policies(workspace_id);

        CREATE TABLE IF NOT EXISTS mcp_roles (
            role_id        TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT NOT NULL DEFAULT '',
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS mcp_role_members (
            role_id        TEXT NOT NULL,
            workspace_id   TEXT NOT NULL,
            UNIQUE(role_id, workspace_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_role_members_ws ON mcp_role_members(workspace_id);

        CREATE TABLE IF NOT EXISTS mcp_role_policies (
            policy_id      TEXT PRIMARY KEY,
            service_id     TEXT NOT NULL,
            role_id        TEXT NOT NULL,
            enabled        INTEGER NOT NULL DEFAULT 1,
            row_rules      TEXT NOT NULL DEFAULT '[]',
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(service_id, role_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_role_policies_service ON mcp_role_policies(service_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_role_policies_role ON mcp_role_policies(role_id);
        """
    )
    _conn = conn
    return conn


# ── MCP Service CRUD ──────────────────────────────────────────────────

def _service_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def list_services(*, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    rows = conn.execute(
        f"SELECT * FROM mcp_services {where} ORDER BY updated_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_service_from_row(row) for row in rows]


def get_service(service_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM mcp_services WHERE service_id = ?", (service_id,)
    ).fetchone()
    return _service_from_row(row) if row else None


def register_service(
    *,
    service_id: str | None = None,
    name: str,
    description: str = "",
    service_type: str = SERVICE_TYPE_DATABASE,
    endpoint_url: str = "",
    db_type: str = "",
) -> dict[str, Any]:
    conn = _ensure_conn()
    sid = (service_id or f"mcp_{uuid.uuid4().hex[:12]}").strip()
    conn.execute(
        """
        INSERT OR REPLACE INTO mcp_services (
            service_id, name, description, service_type, endpoint_url, db_type, status, source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'online', 'manual', datetime('now'))
        """,
        (sid, name.strip(), description.strip(), service_type.strip(), endpoint_url.strip(), db_type.strip()),
    )
    return get_service(sid) or {}


def update_service(
    service_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    endpoint_url: str | None = None,
    db_type: str | None = None,
    status: str | None = None,
) -> dict[str, Any] | None:
    existing = get_service(service_id)
    if existing is None:
        return None
    updates: dict[str, Any] = {}
    if name is not None:
        updates["name"] = name.strip()
    if description is not None:
        updates["description"] = description.strip()
    if endpoint_url is not None:
        updates["endpoint_url"] = endpoint_url.strip()
    if db_type is not None:
        updates["db_type"] = db_type.strip()
    if status is not None:
        updates["status"] = status.strip()
    if not updates:
        return existing
    conn = _ensure_conn()
    sets = ", ".join(f"{key}=?" for key in updates) + ", updated_at=datetime('now')"
    conn.execute(
        f"UPDATE mcp_services SET {sets} WHERE service_id=?",
        (*updates.values(), service_id),
    )
    return get_service(service_id)


def delete_service(service_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute("DELETE FROM mcp_services WHERE service_id=?", (service_id,))
    conn.execute("DELETE FROM mcp_workspace_policies WHERE service_id=?", (service_id,))
    return cur.rowcount > 0


# ── Workspace Policy CRUD ─────────────────────────────────────────────

def _policy_from_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    try:
        d["row_rules"] = json.loads(d.get("row_rules", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["row_rules"] = []
    return d


def get_policy(service_id: str, workspace_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM mcp_workspace_policies WHERE service_id=? AND workspace_id=?",
        (service_id, workspace_id),
    ).fetchone()
    return _policy_from_row(row) if row else None


def list_policies_for_service(service_id: str) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        "SELECT * FROM mcp_workspace_policies WHERE service_id=? ORDER BY updated_at DESC",
        (service_id,),
    ).fetchall()
    return [_policy_from_row(row) for row in rows]


def set_policy(
    service_id: str,
    workspace_id: str,
    *,
    enabled: bool,
    row_rules: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    conn = _ensure_conn()
    policy_id = f"pol_{uuid.uuid4().hex[:12]}"
    rules_json = json.dumps(row_rules or [], ensure_ascii=False)
    conn.execute(
        """
        INSERT INTO mcp_workspace_policies (policy_id, service_id, workspace_id, enabled, row_rules, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(service_id, workspace_id) DO UPDATE SET
            enabled=excluded.enabled,
            row_rules=excluded.row_rules,
            updated_at=datetime('now')
        """,
        (policy_id, service_id, workspace_id, 1 if enabled else 0, rules_json),
    )
    return get_policy(service_id, workspace_id) or {}


def delete_policy(service_id: str, workspace_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute(
        "DELETE FROM mcp_workspace_policies WHERE service_id=? AND workspace_id=?",
        (service_id, workspace_id),
    )
    return cur.rowcount > 0


# ── Role CRUD ──────────────────────────────────────────────────────────

def _role_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def list_roles() -> list[dict[str, Any]]:
    rows = _ensure_conn().execute("SELECT * FROM mcp_roles ORDER BY name").fetchall()
    return [_role_from_row(r) for r in rows]


def get_role(role_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute("SELECT * FROM mcp_roles WHERE role_id=?", (role_id,)).fetchone()
    return _role_from_row(row) if row else None


def create_role(*, name: str, description: str = "") -> dict[str, Any]:
    conn = _ensure_conn()
    role_id = f"role_{uuid.uuid4().hex[:10]}"
    conn.execute(
        "INSERT INTO mcp_roles (role_id, name, description) VALUES (?, ?, ?)",
        (role_id, name.strip(), description.strip()),
    )
    return get_role(role_id) or {}


def update_role(role_id: str, *, name: str | None = None, description: str | None = None) -> dict[str, Any] | None:
    existing = get_role(role_id)
    if existing is None:
        return None
    updates: dict[str, Any] = {}
    if name is not None:
        updates["name"] = name.strip()
    if description is not None:
        updates["description"] = description.strip()
    if not updates:
        return existing
    conn = _ensure_conn()
    sets = ", ".join(f"{k}=?" for k in updates) + ", updated_at=datetime('now')"
    conn.execute(f"UPDATE mcp_roles SET {sets} WHERE role_id=?", (*updates.values(), role_id))
    return get_role(role_id)


def delete_role(role_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute("DELETE FROM mcp_roles WHERE role_id=?", (role_id,))
    conn.execute("DELETE FROM mcp_role_members WHERE role_id=?", (role_id,))
    conn.execute("DELETE FROM mcp_role_policies WHERE role_id=?", (role_id,))
    return cur.rowcount > 0


# ── Role Members ───────────────────────────────────────────────────────

def list_role_members(role_id: str) -> list[str]:
    rows = _ensure_conn().execute(
        "SELECT workspace_id FROM mcp_role_members WHERE role_id=? ORDER BY workspace_id",
        (role_id,),
    ).fetchall()
    return [r["workspace_id"] for r in rows]


def list_workspace_roles(workspace_id: str) -> list[str]:
    rows = _ensure_conn().execute(
        "SELECT role_id FROM mcp_role_members WHERE workspace_id=?",
        (workspace_id,),
    ).fetchall()
    return [r["role_id"] for r in rows]


def set_role_members(role_id: str, workspace_ids: list[str]) -> list[str]:
    conn = _ensure_conn()
    conn.execute("DELETE FROM mcp_role_members WHERE role_id=?", (role_id,))
    for ws_id in workspace_ids:
        conn.execute(
            "INSERT OR IGNORE INTO mcp_role_members (role_id, workspace_id) VALUES (?, ?)",
            (role_id, ws_id.strip()),
        )
    return list_role_members(role_id)


# ── Role Policies ──────────────────────────────────────────────────────

def get_role_policy(service_id: str, role_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM mcp_role_policies WHERE service_id=? AND role_id=?",
        (service_id, role_id),
    ).fetchone()
    if row is None:
        return None
    d = dict(row)
    try:
        d["row_rules"] = json.loads(d.get("row_rules", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["row_rules"] = []
    return d


def list_role_policies_for_service(service_id: str) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        "SELECT p.*, r.name AS role_name FROM mcp_role_policies p "
        "JOIN mcp_roles r ON r.role_id = p.role_id "
        "WHERE p.service_id=? ORDER BY r.name",
        (service_id,),
    ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        d = dict(row)
        try:
            d["row_rules"] = json.loads(d.get("row_rules", "[]"))
        except (json.JSONDecodeError, TypeError):
            d["row_rules"] = []
        d["members"] = list_role_members(row["role_id"])
        result.append(d)
    return result


def set_role_policy(
    service_id: str,
    role_id: str,
    *,
    enabled: bool,
    row_rules: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    conn = _ensure_conn()
    policy_id = f"rpol_{uuid.uuid4().hex[:12]}"
    rules_json = json.dumps(row_rules or [], ensure_ascii=False)
    conn.execute(
        """
        INSERT INTO mcp_role_policies (policy_id, service_id, role_id, enabled, row_rules, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(service_id, role_id) DO UPDATE SET
            enabled=excluded.enabled,
            row_rules=excluded.row_rules,
            updated_at=datetime('now')
        """,
        (policy_id, service_id, role_id, 1 if enabled else 0, rules_json),
    )
    return get_role_policy(service_id, role_id) or {}


def delete_role_policy(service_id: str, role_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute(
        "DELETE FROM mcp_role_policies WHERE service_id=? AND role_id=?",
        (service_id, role_id),
    )
    return cur.rowcount > 0


# ── Merged resolution (direct + role-inherited) ────────────────────────

def list_policies_for_workspace(workspace_id: str) -> list[dict[str, Any]]:
    """Return all MCP connections for a workspace — direct policies first, then role-inherited.

    Direct workspace policies take precedence over role-inherited ones for the same service.
    """
    conn = _ensure_conn()

    # 1) Direct workspace policies
    direct_rows = conn.execute(
        "SELECT p.*, s.name, s.service_type, s.endpoint_url, s.db_type, 'direct' AS source "
        "FROM mcp_workspace_policies p "
        "JOIN mcp_services s ON s.service_id = p.service_id "
        "WHERE p.workspace_id=? AND p.enabled=1 AND s.status='online'",
        (workspace_id,),
    ).fetchall()

    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for row in direct_rows:
        d = dict(row)
        try:
            d["row_rules"] = json.loads(d.get("row_rules", "[]"))
        except (json.JSONDecodeError, TypeError):
            d["row_rules"] = []
        seen.add(d["service_id"])
        result.append(d)

    # 2) Role-inherited policies (skip services already covered by direct)
    role_ids = list_workspace_roles(workspace_id)
    if role_ids:
        placeholders = ",".join("?" * len(role_ids))
        role_rows = conn.execute(
            f"SELECT p.*, s.name, s.service_type, s.endpoint_url, s.db_type, r.name AS role_name, 'role' AS source "
            f"FROM mcp_role_policies p "
            f"JOIN mcp_services s ON s.service_id = p.service_id "
            f"JOIN mcp_roles r ON r.role_id = p.role_id "
            f"WHERE p.role_id IN ({placeholders}) AND p.enabled=1 AND s.status='online' "
            f"ORDER BY r.name, s.name",
            role_ids,
        ).fetchall()
        for row in role_rows:
            if row["service_id"] in seen:
                continue
            d = dict(row)
            try:
                d["row_rules"] = json.loads(d.get("row_rules", "[]"))
            except (json.JSONDecodeError, TypeError):
                d["row_rules"] = []
            seen.add(d["service_id"])
            result.append(d)

    return result

def registry_stats() -> dict[str, Any]:
    conn = _ensure_conn()
    total = conn.execute("SELECT COUNT(*) AS c FROM mcp_services").fetchone()["c"]
    active = conn.execute("SELECT COUNT(*) AS c FROM mcp_services WHERE status='online'").fetchone()["c"]
    policies = conn.execute("SELECT COUNT(*) AS c FROM mcp_workspace_policies").fetchone()["c"]
    by_type_rows = conn.execute(
        "SELECT service_type, COUNT(*) AS c FROM mcp_services GROUP BY service_type"
    ).fetchall()
    return {
        "total_services": total,
        "online_services": active,
        "total_policies": policies,
        "by_service_type": {row["service_type"]: row["c"] for row in by_type_rows},
    }
