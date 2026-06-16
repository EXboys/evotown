"""MCP service registry — evotown managed MCP service catalog and workspace policies.

MCP services are registered by backend operators (not by frontend).
Each workspace can be granted access with optional row-level rules.
Agent roles manage both MCP permissions and system-level capabilities.
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

# ── System functions (hardcoded, not user-editable) ────────────────────

SYSTEM_FUNCTIONS: list[dict[str, str]] = [
    {"func_id": "mcp.access", "name": "MCP 访问权限", "description": "允许调用已注册的 MCP 服务"},
    {"func_id": "mcp.develop", "name": "MCP 开发权限", "description": "允许开发/部署 MCP Proxy"},
    {"func_id": "skill.publish", "name": "技能发布", "description": "允许发布技能到企业市场"},
    {"func_id": "workspace.hosted", "name": "常驻实例", "description": "允许 workspace 保持常驻运行"},
]


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
            manifest       TEXT NOT NULL DEFAULT '{}',
            workspace_id   TEXT NOT NULL DEFAULT '',
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

        CREATE TABLE IF NOT EXISTS agent_roles (
            role_id        TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT NOT NULL DEFAULT '',
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agent_role_members (
            role_id        TEXT NOT NULL,
            workspace_id   TEXT NOT NULL,
            UNIQUE(role_id, workspace_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_role_members_ws ON agent_role_members(workspace_id);

        CREATE TABLE IF NOT EXISTS agent_role_mcp_policies (
            policy_id      TEXT PRIMARY KEY,
            service_id     TEXT NOT NULL,
            role_id        TEXT NOT NULL,
            enabled        INTEGER NOT NULL DEFAULT 1,
            row_rules      TEXT NOT NULL DEFAULT '[]',
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(service_id, role_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_role_mcp_svc ON agent_role_mcp_policies(service_id);
        CREATE INDEX IF NOT EXISTS idx_agent_role_mcp_role ON agent_role_mcp_policies(role_id);

        CREATE TABLE IF NOT EXISTS system_functions (
            func_id        TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT NOT NULL DEFAULT '',
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agent_role_functions (
            role_id        TEXT NOT NULL,
            func_id        TEXT NOT NULL,
            UNIQUE(role_id, func_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_role_funcs_func ON agent_role_functions(func_id);

        CREATE TABLE IF NOT EXISTS system_dimension_registry (
            dim_id               TEXT PRIMARY KEY,
            label                TEXT NOT NULL,
            db_connection_id     TEXT NOT NULL,
            table_name           TEXT NOT NULL,
            column_name          TEXT NOT NULL,
            created_at           TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )

    # ── Migration: old tables → new tables ────────────────────────
    _migrate_tables(conn)

    # ── Migration: mcp_services new columns ────────────────────────
    _migrate_mcp_services_columns(conn)

    # ── Seed hardcoded system functions ───────────────────────────
    for func in SYSTEM_FUNCTIONS:
        conn.execute(
            "INSERT OR IGNORE INTO system_functions (func_id, name, description) VALUES (?, ?, ?)",
            (func["func_id"], func["name"], func["description"]),
        )

    _conn = conn
    return conn


def _migrate_tables(conn: sqlite3.Connection) -> None:
    """Migrate old mcp_roles / mcp_role_members / mcp_role_policies to new names."""
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}

    # If old tables have data but new table is empty, drop empty new and rename
    if "mcp_roles" in tables:
        old_cnt = conn.execute("SELECT COUNT(*) FROM mcp_roles").fetchone()[0]
        new_cnt = 0
        if "agent_roles" in tables:
            new_cnt = conn.execute("SELECT COUNT(*) FROM agent_roles").fetchone()[0]
        if old_cnt > 0 and new_cnt == 0:
            conn.execute("DROP TABLE IF EXISTS agent_roles")
            conn.execute("DROP TABLE IF EXISTS agent_role_members")
            conn.execute("DROP TABLE IF EXISTS agent_role_mcp_policies")
            conn.execute("DROP TABLE IF EXISTS agent_role_functions")
            conn.execute("ALTER TABLE mcp_roles RENAME TO agent_roles")
            conn.execute("ALTER TABLE mcp_role_members RENAME TO agent_role_members")
            conn.execute("ALTER TABLE mcp_role_policies RENAME TO agent_role_mcp_policies")
            # Recreate tables that were dropped
            conn.execute(
                """CREATE TABLE IF NOT EXISTS agent_role_functions (
                    role_id TEXT NOT NULL, func_id TEXT NOT NULL,
                    UNIQUE(role_id, func_id))"""
            )
            conn.execute(
                """CREATE TABLE IF NOT EXISTS system_functions (
                    func_id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))"""
            )

    # Ensure indexes exist
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_role_members_ws ON agent_role_members(workspace_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_role_mcp_svc ON agent_role_mcp_policies(service_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_role_mcp_role ON agent_role_mcp_policies(role_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_role_funcs_func ON agent_role_functions(func_id)")


def _migrate_mcp_services_columns(conn: sqlite3.Connection) -> None:
    """Add manifest and workspace_id columns to mcp_services if missing."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(mcp_services)").fetchall()}
    if "manifest" not in cols:
        conn.execute("ALTER TABLE mcp_services ADD COLUMN manifest TEXT NOT NULL DEFAULT '{}'")
    if "workspace_id" not in cols:
        conn.execute("ALTER TABLE mcp_services ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mcp_services_workspace ON mcp_services(workspace_id)")


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
    conn.execute("DELETE FROM agent_role_mcp_policies WHERE service_id=?", (service_id,))
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


# ── Agent Role CRUD ────────────────────────────────────────────────────

def _role_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def list_roles() -> list[dict[str, Any]]:
    rows = _ensure_conn().execute("SELECT * FROM agent_roles ORDER BY name").fetchall()
    return [_role_from_row(r) for r in rows]


def get_role(role_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute("SELECT * FROM agent_roles WHERE role_id=?", (role_id,)).fetchone()
    return _role_from_row(row) if row else None


def create_role(*, name: str, description: str = "") -> dict[str, Any]:
    conn = _ensure_conn()
    role_id = f"role_{uuid.uuid4().hex[:10]}"
    conn.execute(
        "INSERT INTO agent_roles (role_id, name, description) VALUES (?, ?, ?)",
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
    conn.execute(f"UPDATE agent_roles SET {sets} WHERE role_id=?", (*updates.values(), role_id))
    return get_role(role_id)


def delete_role(role_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute("DELETE FROM agent_roles WHERE role_id=?", (role_id,))
    conn.execute("DELETE FROM agent_role_members WHERE role_id=?", (role_id,))
    conn.execute("DELETE FROM agent_role_mcp_policies WHERE role_id=?", (role_id,))
    conn.execute("DELETE FROM agent_role_functions WHERE role_id=?", (role_id,))
    return cur.rowcount > 0


# ── Role Members ───────────────────────────────────────────────────────

def list_role_members(role_id: str) -> list[str]:
    rows = _ensure_conn().execute(
        "SELECT workspace_id FROM agent_role_members WHERE role_id=? ORDER BY workspace_id",
        (role_id,),
    ).fetchall()
    return [r["workspace_id"] for r in rows]


def list_workspace_roles(workspace_id: str) -> list[str]:
    rows = _ensure_conn().execute(
        "SELECT role_id FROM agent_role_members WHERE workspace_id=?",
        (workspace_id,),
    ).fetchall()
    return [r["role_id"] for r in rows]


def set_role_members(role_id: str, workspace_ids: list[str]) -> list[str]:
    conn = _ensure_conn()
    conn.execute("DELETE FROM agent_role_members WHERE role_id=?", (role_id,))
    for ws_id in workspace_ids:
        conn.execute(
            "INSERT OR IGNORE INTO agent_role_members (role_id, workspace_id) VALUES (?, ?)",
            (role_id, ws_id.strip()),
        )
    return list_role_members(role_id)


# ── Role MCP Policies ──────────────────────────────────────────────────

def get_role_policy(service_id: str, role_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM agent_role_mcp_policies WHERE service_id=? AND role_id=?",
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
        "SELECT p.*, r.name AS role_name FROM agent_role_mcp_policies p "
        "JOIN agent_roles r ON r.role_id = p.role_id "
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
        INSERT INTO agent_role_mcp_policies (policy_id, service_id, role_id, enabled, row_rules, updated_at)
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
        "DELETE FROM agent_role_mcp_policies WHERE service_id=? AND role_id=?",
        (service_id, role_id),
    )
    return cur.rowcount > 0


# ── System Functions ───────────────────────────────────────────────────

def list_system_functions() -> list[dict[str, Any]]:
    """Return all hardcoded system functions."""
    rows = _ensure_conn().execute("SELECT * FROM system_functions ORDER BY func_id").fetchall()
    return [dict(r) for r in rows]


def list_function_assignments(func_id: str) -> list[dict[str, Any]]:
    """For a given function, return all roles and workspaces that have it (union across roles)."""
    conn = _ensure_conn()
    rows = conn.execute(
        """
        SELECT r.role_id, r.name AS role_name, m.workspace_id
        FROM agent_role_functions f
        JOIN agent_roles r ON r.role_id = f.role_id
        LEFT JOIN agent_role_members m ON m.role_id = f.role_id
        WHERE f.func_id = ?
        ORDER BY r.name, m.workspace_id
        """,
        (func_id,),
    ).fetchall()
    # Group by role, collect workspace_ids
    roles_map: dict[str, dict[str, Any]] = {}
    for row in rows:
        rid = row["role_id"]
        if rid not in roles_map:
            roles_map[rid] = {"role_id": rid, "role_name": row["role_name"], "workspace_ids": []}
        ws = row["workspace_id"]
        if ws and ws not in roles_map[rid]["workspace_ids"]:
            roles_map[rid]["workspace_ids"].append(ws)
    return list(roles_map.values())


def set_role_functions(role_id: str, func_ids: list[str]) -> list[str]:
    """Set the function capabilities for a role. Returns the final func_id list."""
    conn = _ensure_conn()
    conn.execute("DELETE FROM agent_role_functions WHERE role_id=?", (role_id,))
    valid_funcs = {r["func_id"] for r in conn.execute("SELECT func_id FROM system_functions").fetchall()}
    for fid in func_ids:
        fid = fid.strip()
        if fid in valid_funcs:
            conn.execute(
                "INSERT OR IGNORE INTO agent_role_functions (role_id, func_id) VALUES (?, ?)",
                (role_id, fid),
            )
    return list_role_functions(role_id)


def list_role_functions(role_id: str) -> list[str]:
    """Return func_ids assigned to a role."""
    rows = _ensure_conn().execute(
        "SELECT func_id FROM agent_role_functions WHERE role_id=? ORDER BY func_id",
        (role_id,),
    ).fetchall()
    return [r["func_id"] for r in rows]


def list_workspace_functions(workspace_id: str) -> list[str]:
    """Return merged func_ids from all roles a workspace belongs to (union)."""
    role_ids = list_workspace_roles(workspace_id)
    if not role_ids:
        return []
    placeholders = ",".join("?" * len(role_ids))
    rows = _ensure_conn().execute(
        f"SELECT DISTINCT func_id FROM agent_role_functions WHERE role_id IN ({placeholders}) ORDER BY func_id",
        role_ids,
    ).fetchall()
    return [r["func_id"] for r in rows]


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
            f"FROM agent_role_mcp_policies p "
            f"JOIN mcp_services s ON s.service_id = p.service_id "
            f"JOIN agent_roles r ON r.role_id = p.role_id "
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


# ── System Dimension Registry CRUD ────────────────────────────────────

def _dimension_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def list_dimensions() -> list[dict[str, Any]]:
    rows = _ensure_conn().execute("SELECT * FROM system_dimension_registry ORDER BY dim_id").fetchall()
    return [_dimension_from_row(r) for r in rows]


def create_dimension(*, dim_id: str, label: str, db_connection_id: str, table_name: str, column_name: str) -> dict[str, Any]:
    conn = _ensure_conn()
    conn.execute(
        "INSERT INTO system_dimension_registry (dim_id, label, db_connection_id, table_name, column_name) VALUES (?, ?, ?, ?, ?)",
        (dim_id.strip(), label.strip(), db_connection_id.strip(), table_name.strip(), column_name.strip()),
    )
    row = conn.execute("SELECT * FROM system_dimension_registry WHERE dim_id=?", (dim_id,)).fetchone()
    return _dimension_from_row(row) if row else {}


def delete_dimension(dim_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute("DELETE FROM system_dimension_registry WHERE dim_id=?", (dim_id,))
    return cur.rowcount > 0


def get_dimension_values(dim_id: str) -> list[str]:
    """Query actual data values from the dimension's source table/column via database_connections."""
    dim = _ensure_conn().execute("SELECT * FROM system_dimension_registry WHERE dim_id=?", (dim_id,)).fetchone()
    if dim is None:
        return []
    try:
        from infra import database_registry
        conn = database_registry.get_connection(dim["db_connection_id"], include_secrets=True)
        if conn is None:
            return []
        config = conn.get("config", {})
        db_type = conn.get("db_type", "")

        table = dim["table_name"]
        column = dim["column_name"]
        sql = f"SELECT DISTINCT {column} FROM {table} ORDER BY {column} LIMIT 1000"

        import sqlite3 as _sqlite3
        if db_type == "sqlite":
            db_conn = _sqlite3.connect(config.get("path") or config.get("database", ""), timeout=10)
            try:
                rows = db_conn.execute(sql).fetchall()
                return [str(r[0]) for r in rows if r[0] is not None]
            finally:
                db_conn.close()
        elif db_type == "postgres":
            import psycopg
            host = config.get("host", "localhost")
            port = config.get("port", 5432)
            database = config.get("database", "")
            user = config.get("username", "")
            pwd = config.get("password", "")
            conninfo = f"host={host} port={port} dbname={database} user={user} password={pwd} connect_timeout=10"
            with psycopg.connect(conninfo) as pg_conn:
                with pg_conn.cursor() as cur:
                    cur.execute(sql)
                    return [str(r[0]) for r in cur.fetchall() if r[0] is not None]
        elif db_type == "mysql":
            import pymysql
            host = config.get("host", "localhost")
            port = int(config.get("port", 3306))
            database = config.get("database", "")
            user = config.get("username", "")
            pwd = config.get("password", "")
            my_conn = pymysql.connect(host=host, port=port, user=user, password=pwd, database=database, connect_timeout=10)
            try:
                with my_conn.cursor() as cur:
                    cur.execute(sql)
                    return [str(r[0]) for r in cur.fetchall() if r[0] is not None]
            finally:
                my_conn.close()
        return []
    except Exception:
        return []
