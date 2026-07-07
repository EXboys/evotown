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

STATUS_ONLINE = "online"
STATUS_OFFLINE = "offline"
STATUS_ERROR = "error"
STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_DEPRECATED = "deprecated"

SOURCE_INTERNAL = "internal"
SOURCE_EXTERNAL = "external"
SOURCE_SYSTEM = "system"

SOURCE_LABELS: dict[str, str] = {
    SOURCE_INTERNAL: "内部 MCP",
    SOURCE_EXTERNAL: "外部 MCP",
    SOURCE_SYSTEM: "系统 MCP",
}


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
            status         TEXT NOT NULL DEFAULT 'online',
            source         TEXT NOT NULL DEFAULT 'manual',
            endpoint_url   TEXT NOT NULL DEFAULT '',
            mcp_path       TEXT NOT NULL DEFAULT '',
            category       TEXT NOT NULL DEFAULT '',
            version        TEXT NOT NULL DEFAULT '',
            dimensions     TEXT NOT NULL DEFAULT '[]',
            tables         TEXT NOT NULL DEFAULT '[]',
            input_schema   TEXT NOT NULL DEFAULT '{}',
            output_schema  TEXT NOT NULL DEFAULT '{}',
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_services_status ON mcp_services(status);

        CREATE TABLE IF NOT EXISTS agent_mcp_policies (
            policy_id      TEXT PRIMARY KEY,
            service_id     TEXT NOT NULL,
            agent_id   TEXT NOT NULL,
            enabled        INTEGER NOT NULL DEFAULT 1,
            row_rules      TEXT NOT NULL DEFAULT '[]',
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(service_id, agent_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_policies_service ON agent_mcp_policies(service_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_policies_workspace ON agent_mcp_policies(agent_id);

        CREATE TABLE IF NOT EXISTS agent_roles (
            role_id        TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT NOT NULL DEFAULT '',
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agent_role_members (
            role_id        TEXT NOT NULL,
            agent_id   TEXT NOT NULL,
            UNIQUE(role_id, agent_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_role_members_ws ON agent_role_members(agent_id);

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

        CREATE TABLE IF NOT EXISTS system_dimension_registry (
            dim_id               TEXT PRIMARY KEY,
            label                TEXT NOT NULL,
            db_connection_id     TEXT NOT NULL,
            table_name           TEXT NOT NULL,
            column_name          TEXT NOT NULL,
            created_at           TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS mcp_usage_log (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id         TEXT NOT NULL DEFAULT '',
            agent_id       TEXT NOT NULL DEFAULT '',
            account_id     TEXT NOT NULL DEFAULT '',
            service_id     TEXT NOT NULL,
            args           TEXT NOT NULL DEFAULT '',
            status         TEXT NOT NULL DEFAULT '',
            result         TEXT NOT NULL DEFAULT '',
            called_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_usage_service ON mcp_usage_log(service_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_usage_time ON mcp_usage_log(called_at);

        CREATE TABLE IF NOT EXISTS mcp_service_versions (
            version_id              TEXT PRIMARY KEY,
            service_id              TEXT NOT NULL,
            version                 TEXT NOT NULL DEFAULT '',
            version_notes           TEXT NOT NULL DEFAULT '',
            snapshot_dimensions     TEXT NOT NULL DEFAULT '[]',
            snapshot_tables         TEXT NOT NULL DEFAULT '[]',
            snapshot_input_schema   TEXT NOT NULL DEFAULT '{}',
            snapshot_output_schema  TEXT NOT NULL DEFAULT '{}',
            status                  TEXT NOT NULL DEFAULT 'pending',
            submitted_by_agent_id  TEXT NOT NULL DEFAULT '',
            submitted_by_account    TEXT NOT NULL DEFAULT '',
            submitted_at            TEXT NOT NULL DEFAULT (datetime('now')),
            reviewed_by             TEXT NOT NULL DEFAULT '',
            reviewed_at             TEXT NOT NULL DEFAULT '',
            review_comment          TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_versions_service ON mcp_service_versions(service_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_versions_status ON mcp_service_versions(status);

        CREATE TABLE IF NOT EXISTS agent_role_dimensions (
            role_id        TEXT NOT NULL,
            dim_id         TEXT NOT NULL,
            dim_values     TEXT NOT NULL DEFAULT '[]',
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (role_id, dim_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ard_role ON agent_role_dimensions(role_id);
        CREATE INDEX IF NOT EXISTS idx_ard_dim ON agent_role_dimensions(dim_id);
        """
    )

    # ── Migration: old tables → new tables ────────────────────────
    _migrate_tables(conn)

    # ── Migration: mcp_services drop legacy columns ────────────────
    _migrate_drop_legacy_columns(conn)

    # ── Migration: mcp_services source values ──────────────────────
    _migrate_source_values(conn)

    # ── Migration: dimension registry updated_at ──────────────────
    _migrate_dimension_registry(conn)

    # ── Migration: mcp_usage_log audit columns ────────────────────
    _migrate_mcp_usage_log(conn)

    # ── Scan and register system MCP services ────────────────────
    _scan_system_mcps(conn)

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
            conn.execute("ALTER TABLE mcp_roles RENAME TO agent_roles")
            conn.execute("ALTER TABLE mcp_role_members RENAME TO agent_role_members")
            conn.execute("ALTER TABLE mcp_role_policies RENAME TO agent_role_mcp_policies")

    # Migrate mcp_workspace_policies → agent_mcp_policies and rename workspace_id → agent_id
    if "mcp_workspace_policies" in tables:
        old_cnt = conn.execute("SELECT COUNT(*) FROM mcp_workspace_policies").fetchone()[0]
        new_cnt = 0
        if "agent_mcp_policies" in tables:
            new_cnt = conn.execute("SELECT COUNT(*) FROM agent_mcp_policies").fetchone()[0]
        if old_cnt > 0 and new_cnt == 0:
            conn.execute("DROP TABLE IF EXISTS agent_mcp_policies")
            conn.execute("ALTER TABLE mcp_workspace_policies RENAME TO agent_mcp_policies")
    
    # Rename workspace_id → agent_id in existing tables
    for tbl in ["agent_mcp_policies", "agent_role_members", "mcp_services"]:
        if tbl in tables:
            cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({tbl})").fetchall()}
            if "workspace_id" in cols and "agent_id" not in cols:
                conn.execute(f"ALTER TABLE {tbl} RENAME COLUMN workspace_id TO agent_id")
    
    # submitted_by_workspace → submitted_by_agent_id in mcp_service_versions
    if "mcp_service_versions" in tables:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(mcp_service_versions)").fetchall()}
        if "submitted_by_workspace" in cols and "submitted_by_agent_id" not in cols:
            conn.execute("ALTER TABLE mcp_service_versions RENAME COLUMN submitted_by_workspace TO submitted_by_agent_id")

    # Ensure indexes exist
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_role_members_ws ON agent_role_members(agent_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_role_mcp_svc ON agent_mcp_policies(service_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_role_mcp_role ON agent_mcp_policies(role_id)")


def _migrate_drop_legacy_columns(conn: sqlite3.Connection) -> None:
    """Drop legacy columns (db_type, manifest, agent_id, service_type) if they exist.

    SQLite doesn't support DROP COLUMN in older versions, so we use a recreation strategy
    only if the table was created with the old schema (has 'db_type' column).
    """
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(mcp_services)").fetchall()}
    legacy = {"db_type", "manifest", "agent_id", "service_type"} & cols
    if not legacy:
        return
    # Simple approach: just ignore the columns (SQLite is flexible with extra columns).
    # The new schema doesn't include them, but old rows still have them — harmless.


def _migrate_source_values(conn: sqlite3.Connection) -> None:
    """Migrate source: agent→internal, manual→external."""
    conn.execute("UPDATE mcp_services SET source='internal' WHERE source='agent'")
    conn.execute("UPDATE mcp_services SET source='external' WHERE source='manual'")


def _migrate_dimension_registry(conn: sqlite3.Connection) -> None:
    """Add updated_at, db_name, and code columns to system_dimension_registry if missing."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(system_dimension_registry)").fetchall()}
    if "updated_at" not in cols:
        conn.execute("ALTER TABLE system_dimension_registry ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))")
    if "db_name" not in cols:
        conn.execute("ALTER TABLE system_dimension_registry ADD COLUMN db_name TEXT NOT NULL DEFAULT ''")
    if "code" not in cols:
        conn.execute("ALTER TABLE system_dimension_registry ADD COLUMN code TEXT NOT NULL DEFAULT ''")


def _migrate_mcp_usage_log(conn: sqlite3.Connection) -> None:
    """Add audit columns to mcp_usage_log if missing (REQ-014)."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(mcp_usage_log)").fetchall()}
    for col, col_def in [
        ("run_id", "TEXT NOT NULL DEFAULT ''"),
        ("agent_id", "TEXT NOT NULL DEFAULT ''"),
        ("account_id", "TEXT NOT NULL DEFAULT ''"),
        ("args", "TEXT NOT NULL DEFAULT ''"),
        ("status", "TEXT NOT NULL DEFAULT ''"),
        ("result", "TEXT NOT NULL DEFAULT ''"),
    ]:
        if col not in cols:
            conn.execute(f"ALTER TABLE mcp_usage_log ADD COLUMN {col} {col_def}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mcp_usage_run ON mcp_usage_log(run_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mcp_usage_agent ON mcp_usage_log(agent_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mcp_usage_account ON mcp_usage_log(account_id, called_at)")


# ── MCP Service CRUD ──────────────────────────────────────────────────

def _service_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def list_services(*, status: str | None = None, source: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if source:
        clauses.append("source = ?")
        params.append(source)
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
    endpoint_url: str = "",
    source: str = SOURCE_INTERNAL,
    mcp_path: str = "",
    category: str = "",
    version: str = "",
    dimensions: list[str] | None = None,
    tables: list[str] | None = None,
    input_schema: dict[str, Any] | None = None,
    output_schema: dict[str, Any] | None = None,
    status: str = STATUS_ONLINE,
) -> dict[str, Any]:
    conn = _ensure_conn()
    sid = (service_id or f"mcp_{uuid.uuid4().hex[:12]}").strip()
    conn.execute(
        """
        INSERT OR REPLACE INTO mcp_services (
            service_id, name, description, endpoint_url,
            status, source, mcp_path, category, version,
            dimensions, tables, input_schema, output_schema,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """,
        (
            sid, name.strip(), description.strip(), endpoint_url.strip(),
            (status or STATUS_ONLINE).strip(), source.strip(),
            mcp_path.strip(), category.strip(), (version or "").strip(),
            json.dumps(dimensions or [], ensure_ascii=False),
            json.dumps(tables or [], ensure_ascii=False),
            json.dumps(input_schema or {}, ensure_ascii=False),
            json.dumps(output_schema or {}, ensure_ascii=False),
        ),
    )
    return get_service(sid) or {}


def update_service(
    service_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    endpoint_url: str | None = None,
    status: str | None = None,
    source: str | None = None,
) -> dict[str, Any] | None:
    existing = get_service(service_id)
    if existing is None:
        return None
    if existing.get("source") == SOURCE_SYSTEM:
        if any(v is not None for v in [name, description, endpoint_url, source]):
            raise PermissionError("系统 MCP 不可编辑")
        # Only allow status toggle
        if status is not None:
            conn = _ensure_conn()
            conn.execute(
                "UPDATE mcp_services SET status=?, updated_at=datetime('now') WHERE service_id=?",
                (status.strip(), service_id),
            )
            return get_service(service_id)
        return existing
    updates: dict[str, Any] = {}
    if name is not None:
        updates["name"] = name.strip()
    if description is not None:
        updates["description"] = description.strip()
    if endpoint_url is not None:
        updates["endpoint_url"] = endpoint_url.strip()
    if status is not None:
        updates["status"] = status.strip()
    if source is not None:
        updates["source"] = source.strip()
    if not updates:
        return existing
    conn = _ensure_conn()
    sets = ", ".join(f"{key}=?" for key in updates) + ", updated_at=datetime('now')"
    conn.execute(
        f"UPDATE mcp_services SET {sets} WHERE service_id=?",
        (*updates.values(), service_id),
    )
    return get_service(service_id)


def delete_service(service_id: str) -> dict[str, Any]:
    existing = get_service(service_id)
    if existing and existing.get("source") == SOURCE_SYSTEM:
        raise PermissionError("系统 MCP 不可删除")
    if existing is None:
        return {"deleted": False, "cleaned_dirs": [], "cleaned_tables": []}

    import shutil

    conn = _ensure_conn()
    cur = conn.execute("DELETE FROM mcp_services WHERE service_id=?", (service_id,))
    deleted = cur.rowcount > 0

    if not deleted:
        return {"deleted": False, "cleaned_dirs": [], "cleaned_tables": []}

    cleaned_tables: list[str] = ["mcp_services"]

    # Delete related records
    for table in ["agent_mcp_policies", "agent_role_mcp_policies",
                  "mcp_service_versions", "mcp_usage_log"]:
        conn.execute(f"DELETE FROM {table} WHERE service_id=?", (service_id,))
        cleaned_tables.append(table)

    # Clear in-memory handler cache
    try:
        from services.mcp_loader import clear_handler_cache
        clear_handler_cache(service_id)
    except Exception:
        pass

    # Clean up file directories
    cleaned_dirs: list[str] = []
    mcp_path = (existing.get("mcp_path") or "").strip("/")

    if mcp_path:
        # Dev directory: /app/data/mcp-dev/{mcp_path}/
        dev_dir = Path("/app/data/mcp-dev") / mcp_path
        if dev_dir.exists():
            shutil.rmtree(str(dev_dir))
            cleaned_dirs.append(str(dev_dir))

        # Prod directory (approve path): /app/data/mcp-services/{mcp_path}/
        prod_dir = Path("/app/data/mcp-services") / mcp_path
        if prod_dir.exists():
            shutil.rmtree(str(prod_dir))
            cleaned_dirs.append(str(prod_dir))

    # Prod directory (deploy path): /app/data/mcp-services/{service_id}/
    prod_sid_dir = Path("/app/data/mcp-services") / service_id
    if prod_sid_dir.exists():
        shutil.rmtree(str(prod_sid_dir))
        cleaned_dirs.append(str(prod_sid_dir))

    return {"deleted": True, "cleaned_dirs": cleaned_dirs, "cleaned_tables": cleaned_tables}


# ── Workspace Policy CRUD ─────────────────────────────────────────────

def _policy_from_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    try:
        d["row_rules"] = json.loads(d.get("row_rules", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["row_rules"] = []
    return d


def get_policy(service_id: str, agent_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM agent_mcp_policies WHERE service_id=? AND agent_id=?",
        (service_id, agent_id),
    ).fetchone()
    return _policy_from_row(row) if row else None


def list_policies_for_service(service_id: str) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        "SELECT * FROM agent_mcp_policies WHERE service_id=? ORDER BY updated_at DESC",
        (service_id,),
    ).fetchall()
    return [_policy_from_row(row) for row in rows]


def set_policy(
    service_id: str,
    agent_id: str,
    *,
    enabled: bool,
    row_rules: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    conn = _ensure_conn()
    policy_id = f"pol_{uuid.uuid4().hex[:12]}"
    rules_json = json.dumps(row_rules or [], ensure_ascii=False)
    conn.execute(
        """
        INSERT INTO agent_mcp_policies (policy_id, service_id, agent_id, enabled, row_rules, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(service_id, agent_id) DO UPDATE SET
            enabled=excluded.enabled,
            row_rules=excluded.row_rules,
            updated_at=datetime('now')
        """,
        (policy_id, service_id, agent_id, 1 if enabled else 0, rules_json),
    )
    return get_policy(service_id, agent_id) or {}


def delete_policy(service_id: str, agent_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute(
        "DELETE FROM agent_mcp_policies WHERE service_id=? AND agent_id=?",
        (service_id, agent_id),
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
    return cur.rowcount > 0


# ── Role Members ───────────────────────────────────────────────────────

def list_role_members(role_id: str) -> list[str]:
    rows = _ensure_conn().execute(
        "SELECT agent_id FROM agent_role_members WHERE role_id=? ORDER BY agent_id",
        (role_id,),
    ).fetchall()
    return [r["agent_id"] for r in rows]


def list_workspace_roles(agent_id: str) -> list[str]:
    rows = _ensure_conn().execute(
        "SELECT role_id FROM agent_role_members WHERE agent_id=?",
        (agent_id,),
    ).fetchall()
    return [r["role_id"] for r in rows]


def set_role_members(role_id: str, agent_ids: list[str]) -> list[str]:
    conn = _ensure_conn()
    conn.execute("DELETE FROM agent_role_members WHERE role_id=?", (role_id,))
    for ws_id in agent_ids:
        conn.execute(
            "INSERT OR IGNORE INTO agent_role_members (role_id, agent_id) VALUES (?, ?)",
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


# ── Agent role dimensions (REQ-015) ────────────────────────────────

def get_role_dimensions(role_id: str) -> list[dict[str, Any]]:
    """Get all dimension bindings for a role, enriched with dimension metadata."""
    conn = _ensure_conn()
    rows = conn.execute(
        """SELECT ard.dim_id, ard.dim_values, ard.updated_at,
                  sdr.label, sdr.db_connection_id, sdr.table_name, sdr.column_name,
                  sdr.code
           FROM agent_role_dimensions ard
           LEFT JOIN system_dimension_registry sdr ON ard.dim_id = sdr.dim_id
           WHERE ard.role_id = ?""",
        (role_id,),
    ).fetchall()

    result: list[dict[str, Any]] = []
    for r in rows:
        entry: dict[str, Any] = {
            "dim_id": r["dim_id"],
            "dim_values": json.loads(r["dim_values"]),
            "updated_at": r["updated_at"],
        }
        if r["label"] is not None:
            entry["label"] = r["label"]
            entry["code"] = r["code"] or ""
            entry["db_connection_id"] = r["db_connection_id"]
            entry["table_name"] = r["table_name"]
            entry["column_name"] = r["column_name"]
        else:
            entry["label"] = ""
            entry["code"] = ""
            entry["db_connection_id"] = ""
            entry["table_name"] = ""
            entry["column_name"] = ""
        result.append(entry)
    return result


def set_role_dimension(role_id: str, dim_id: str, dim_values: list[str]) -> dict[str, Any]:
    """Upsert a single role-dimension binding. dim_values=["*"] means full access."""
    conn = _ensure_conn()
    values_json = json.dumps(dim_values, ensure_ascii=False)
    conn.execute(
        """INSERT INTO agent_role_dimensions (role_id, dim_id, dim_values, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(role_id, dim_id) DO UPDATE SET
               dim_values = excluded.dim_values,
               updated_at = excluded.updated_at""",
        (role_id, dim_id, values_json),
    )
    return {"role_id": role_id, "dim_id": dim_id, "dim_values": dim_values}


def delete_role_dimension(role_id: str, dim_id: str) -> bool:
    """Remove a single role-dimension binding."""
    conn = _ensure_conn()
    cur = conn.execute(
        "DELETE FROM agent_role_dimensions WHERE role_id=? AND dim_id=?",
        (role_id, dim_id),
    )
    return cur.rowcount > 0


def set_role_dimensions_batch(role_id: str, dimensions: list[dict[str, Any]]) -> int:
    """Replace all dimension bindings for a role in a single transaction.

    Each item: {dim_id: str, dim_values: list[str]}.
    Returns the number of dimensions set.
    """
    conn = _ensure_conn()
    conn.execute("DELETE FROM agent_role_dimensions WHERE role_id=?", (role_id,))
    count = 0
    for dim in dimensions:
        dim_id = dim.get("dim_id", "")
        dim_values = dim.get("dim_values", [])
        if not dim_id or not isinstance(dim_values, list):
            continue
        values_json = json.dumps(dim_values, ensure_ascii=False)
        conn.execute(
            """INSERT INTO agent_role_dimensions (role_id, dim_id, dim_values, updated_at)
               VALUES (?, ?, ?, datetime('now'))""",
            (role_id, dim_id, values_json),
        )
        count += 1
    return count


# ── Merged resolution (direct + role-inherited) ────────────────────────

def list_policies_for_agent(agent_id: str) -> list[dict[str, Any]]:
    """Return all MCP connections for a workspace — direct policies first, then role-inherited.

    Direct workspace policies take precedence over role-inherited ones for the same service.
    """
    conn = _ensure_conn()

    # 1) Direct workspace policies
    direct_rows = conn.execute(
        "SELECT p.*, s.name, 'direct' AS source "
        "FROM agent_mcp_policies p "
        "JOIN mcp_services s ON s.service_id = p.service_id "
        "WHERE p.agent_id=? AND p.enabled=1 AND s.status='online'",
        (agent_id,),
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
    role_ids = list_workspace_roles(agent_id)
    if role_ids:
        placeholders = ",".join("?" * len(role_ids))
        role_rows = conn.execute(
            f"SELECT p.*, s.name, s.name, r.name AS role_name, 'role' AS source "
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


def resolve_mcp_permissions(agent_id: str, service_id: str) -> dict[str, Any]:
    """Resolve data dimension permissions for an agent calling a specific MCP service.

    Returns a dict with:
        permissions: dict[str, list[str]] — resolved dimension values keyed by code
        declared_dims: list[str] — dimension codes the service declares
        has_dimensions: bool — whether the service declares any dimensions
        has_rules: bool — whether the agent has any matching dimension rules
    """
    import json as _json

    permissions: dict[str, Any] = {}
    declared_dims: list[str] = []

    svc = get_service(service_id)
    if svc:
        try:
            declared_dims = _json.loads(str(svc.get("dimensions") or "[]"))
        except (_json.JSONDecodeError, TypeError):
            declared_dims = []

    has_dimensions = bool(declared_dims)
    has_rules = False

    if declared_dims:
        # Resolve dimension values from agent_role_dimensions (via agent's roles)
        role_ids = list_workspace_roles(agent_id)
        for role_id in role_ids:
            for rd in get_role_dimensions(role_id):
                dim_code = rd.get("code", "")
                if dim_code in declared_dims:
                    vals = rd.get("dim_values") or []
                    if vals and vals != ["*"]:
                        # Dedup merge across multiple roles
                        existing = permissions.get(dim_code) or []
                        permissions[dim_code] = list(set(existing + vals))
                        has_rules = True

    permissions["agent_id"] = agent_id

    return {
        "permissions": permissions,
        "declared_dims": declared_dims,
        "has_dimensions": has_dimensions,
        "has_rules": has_rules,
    }


def registry_stats() -> dict[str, Any]:
    conn = _ensure_conn()
    total = conn.execute("SELECT COUNT(*) AS c FROM mcp_services").fetchone()["c"]
    active = conn.execute("SELECT COUNT(*) AS c FROM mcp_services WHERE status='online'").fetchone()["c"]
    policies = conn.execute("SELECT COUNT(*) AS c FROM agent_mcp_policies").fetchone()["c"]
    by_source_rows = conn.execute(
        "SELECT source, COUNT(*) AS c FROM mcp_services GROUP BY source"
    ).fetchall()
    return {
        "total_services": total,
        "online_services": active,
        "total_policies": policies,
        "by_source": {row["source"]: row["c"] for row in by_source_rows},
    }


def count_service_policies(service_id: str) -> int:
    """Return how many workspaces are bound to this MCP service (direct + role)."""
    conn = _ensure_conn()
    # Direct workspace policies
    direct = conn.execute(
        "SELECT COUNT(*) AS c FROM agent_mcp_policies WHERE service_id=? AND enabled=1",
        (service_id,),
    ).fetchone()["c"]
    # Role-based: count unique workspaces via roles
    role_ws = set()
    role_rows = conn.execute(
        "SELECT role_id FROM agent_role_mcp_policies WHERE service_id=? AND enabled=1",
        (service_id,),
    ).fetchall()
    for r in role_rows:
        members = conn.execute(
            "SELECT agent_id FROM agent_role_members WHERE role_id=?",
            (r["role_id"],),
        ).fetchall()
        for m in members:
            role_ws.add(m["agent_id"])
    return direct + len(role_ws)


def record_mcp_call(
    service_id: str,
    *,
    run_id: str = "",
    agent_id: str = "",
    account_id: str = "",
    args: str = "",
    status: str = "",
    result: str = "",
) -> None:
    """Record an MCP service call with full audit trail (REQ-014)."""
    _ensure_conn().execute(
        "INSERT INTO mcp_usage_log (run_id, agent_id, account_id, service_id, args, status, result, called_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        (run_id, agent_id, account_id, service_id, args[:500], status, result[:1000]),
    )


def count_mcp_calls(service_id: str, *, hours: int = 24) -> int:
    """Return number of calls to this MCP service in the last N hours."""
    row = _ensure_conn().execute(
        "SELECT COUNT(*) AS c FROM mcp_usage_log WHERE service_id=? "
        "AND called_at >= datetime('now', ?)",
        (service_id, f"-{hours} hours"),
    ).fetchone()
    return row["c"] if row else 0


def list_mcp_calls(service_id: str, *, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    """List recent MCP call records with pagination."""
    rows = _ensure_conn().execute(
        "SELECT * FROM mcp_usage_log WHERE service_id = ? ORDER BY called_at DESC LIMIT ? OFFSET ?",
        (service_id, limit, offset),
    ).fetchall()
    return [dict(r) for r in rows]


def _mcp_time_filter(from_ts: str | None, to_ts: str | None) -> tuple[str, list[Any]]:
    parts: list[str] = []
    params: list[Any] = []
    if from_ts:
        parts.append("called_at >= ?")
        params.append(from_ts)
    if to_ts:
        parts.append("called_at <= ?")
        params.append(to_ts)
    clause = (" AND " + " AND ".join(parts)) if parts else ""
    return clause, params


def count_mcp_calls_by_account(*, from_ts: str | None = None, to_ts: str | None = None) -> list[dict[str, Any]]:
    clause, params = _mcp_time_filter(from_ts, to_ts)
    rows = _ensure_conn().execute(
        f"""
        SELECT account_id, COUNT(*) AS mcp_calls
        FROM mcp_usage_log
        WHERE account_id != ''{clause}
        GROUP BY account_id
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def count_mcp_calls_by_run_ids(run_ids: list[str]) -> dict[str, int]:
    if not run_ids:
        return {}
    placeholders = ",".join("?" for _ in run_ids)
    rows = _ensure_conn().execute(
        f"""
        SELECT run_id, COUNT(*) AS mcp_calls
        FROM mcp_usage_log
        WHERE run_id IN ({placeholders})
        GROUP BY run_id
        """,
        run_ids,
    ).fetchall()
    return {row["run_id"]: int(row["mcp_calls"]) for row in rows}


def list_mcp_calls_for_account(
    account_id: str,
    *,
    from_ts: str | None = None,
    to_ts: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    clause, params = _mcp_time_filter(from_ts, to_ts)
    effective_limit = max(1, min(limit, 500))
    query_params = [account_id, *params, effective_limit, max(0, offset)]
    rows = _ensure_conn().execute(
        f"""
        SELECT * FROM mcp_usage_log
        WHERE account_id = ?{clause}
        ORDER BY called_at DESC
        LIMIT ? OFFSET ?
        """,
        query_params,
    ).fetchall()
    return [dict(row) for row in rows]


def list_mcp_calls_in_range(
    *,
    from_ts: str | None = None,
    to_ts: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    clause, params = _mcp_time_filter(from_ts, to_ts)
    effective_limit = max(1, min(limit, 500))
    query_params = [*params, effective_limit, max(0, offset)]
    rows = _ensure_conn().execute(
        f"""
        SELECT * FROM mcp_usage_log
        WHERE 1=1{clause}
        ORDER BY called_at DESC
        LIMIT ? OFFSET ?
        """,
        query_params,
    ).fetchall()
    return [dict(row) for row in rows]


def list_mcp_calls_for_run(run_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        "SELECT * FROM mcp_usage_log WHERE run_id = ? ORDER BY called_at ASC LIMIT ?",
        (run_id, max(1, min(limit, 500))),
    ).fetchall()
    return [dict(row) for row in rows]


# ── System Dimension Registry CRUD ────────────────────────────────────

def _dimension_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def list_dimensions() -> list[dict[str, Any]]:
    rows = _ensure_conn().execute("SELECT * FROM system_dimension_registry ORDER BY dim_id").fetchall()
    return [_dimension_from_row(r) for r in rows]


def get_dimension(dim_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM system_dimension_registry WHERE dim_id=?", (dim_id,)
    ).fetchone()
    if row is None:
        return None
    return _dimension_from_row(row)


def _validate_connection(db_connection_id: str) -> dict[str, Any]:
    """Raise ValueError if connection_id is invalid or not active."""
    from infra import database_registry
    db = database_registry.get_connection(db_connection_id, include_secrets=True)
    if db is None:
        raise ValueError(f"数据库连接不存在: {db_connection_id}")
    if db.get("status") != "active":
        raise ValueError(f"数据库连接未激活: {db_connection_id}")
    return db


def _quote_identifier(name: str, db_type: str) -> str:
    """Quote an identifier (table/column name) per database type."""
    if db_type == "mysql":
        return f"`{name}`"
    return f'"{name}"'  # SQLite / Postgres


def _validate_code(code: str) -> str:
    """Validate and strip dimension code. Raises ValueError if invalid."""
    import re
    code = code.strip()
    if not code:
        raise ValueError("维度编码不能为空")
    if not re.match(r'^[a-zA-Z0-9_]+$', code):
        raise ValueError("维度编码仅允许字母、数字、下划线")
    if len(code) > 64:
        raise ValueError("维度编码不能超过 64 个字符")
    return code


def create_dimension(*, dim_id: str = "", label: str, db_connection_id: str, table_name: str, column_name: str, db_name: str = "", code: str = "") -> dict[str, Any]:
    conn = _ensure_conn()
    _validate_connection(db_connection_id)
    code_val = _validate_code(code)
    # Auto-generate dim_id if empty
    import uuid as _uuid
    did = dim_id.strip() if dim_id.strip() else f"dim_{_uuid.uuid4().hex[:10]}"
    conn.execute(
        "INSERT INTO system_dimension_registry (dim_id, label, code, db_connection_id, db_name, table_name, column_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (did, label.strip(), code_val, db_connection_id.strip(), db_name.strip(), table_name.strip(), column_name.strip()),
    )
    row = conn.execute("SELECT * FROM system_dimension_registry WHERE dim_id=?", (did,)).fetchone()
    return _dimension_from_row(row) if row else {}


def update_dimension(dim_id: str, *, label: str | None = None, table_name: str | None = None, column_name: str | None = None, db_name: str | None = None, code: str | None = None) -> dict[str, Any] | None:
    existing = _ensure_conn().execute(
        "SELECT * FROM system_dimension_registry WHERE dim_id=?", (dim_id,)
    ).fetchone()
    if existing is None:
        return None
    updates: dict[str, Any] = {}
    if label is not None:
        updates["label"] = label.strip()
    if table_name is not None:
        updates["table_name"] = table_name.strip()
    if column_name is not None:
        updates["column_name"] = column_name.strip()
    if db_name is not None:
        updates["db_name"] = db_name.strip()
    if code is not None:
        code = code.strip()
        if code:
            import re
            if not re.match(r'^[a-zA-Z0-9_]+$', code):
                raise ValueError("维度编码仅允许字母、数字、下划线")
        updates["code"] = code
    if not updates:
        return dict(existing)
    conn = _ensure_conn()
    updates["updated_at"] = "datetime('now')"
    sets = ", ".join(f"{k}=?" if k != "updated_at" else f"{k}=datetime('now')" for k in updates)
    conn.execute(
        f"UPDATE system_dimension_registry SET {sets} WHERE dim_id=?",
        (*[v for k, v in updates.items() if k != "updated_at"], dim_id),
    )
    row = conn.execute("SELECT * FROM system_dimension_registry WHERE dim_id=?", (dim_id,)).fetchone()
    return dict(row) if row else None


def delete_dimension(dim_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute("DELETE FROM system_dimension_registry WHERE dim_id=?", (dim_id,))
    return cur.rowcount > 0


def _connect_db(db_connection_id: str, *, database: str = ""):
    """Connect to a target database via database_registry. Returns (connection, db_type).

    If `database` is provided, overrides the default database in the connection config
    (PostgreSQL/MySQL only). For SQLite, the parameter is ignored.
    """
    from infra import database_registry
    db = database_registry.get_connection(db_connection_id, include_secrets=True)
    if db is None:
        raise ValueError(f"数据库连接不存在: {db_connection_id}")
    config = db.get("config", {})
    db_type = db.get("db_type", "")
    import sqlite3 as _sqlite3
    if db_type == "sqlite":
        path = config.get("path") or config.get("database", "")
        return _sqlite3.connect(path, timeout=10), "sqlite"
    elif db_type == "postgres":
        import psycopg
        host = config.get("host", "localhost")
        port = config.get("port", 5432)
        dbname = database or config.get("database", "postgres")
        user = config.get("username", "")
        pwd = config.get("password", "")
        conninfo = f"host={host} port={port} dbname={dbname} user={user} password={pwd} connect_timeout=10"
        return psycopg.connect(conninfo), "postgres"
    elif db_type == "mysql":
        import pymysql
        host = config.get("host", "localhost")
        port = int(config.get("port", 3306))
        dbname = database or config.get("database", "")
        user = config.get("username", "")
        pwd = config.get("password", "")
        kwargs = {"host": host, "port": port, "user": user, "password": pwd, "connect_timeout": 10}
        if dbname:
            kwargs["database"] = dbname
        return pymysql.connect(**kwargs), "mysql"
    raise ValueError(f"不支持的数据库类型: {db_type}")


def list_db_names(db_connection_id: str) -> list[str]:
    """List all database/schema names on the server."""
    from infra import database_registry
    db_cfg = database_registry.get_connection(db_connection_id, include_secrets=True)
    if db_cfg is None:
        raise ValueError(f"数据库连接不存在: {db_connection_id}")
    db_type = db_cfg.get("db_type", "")
    if db_type == "sqlite":
        return []  # SQLite has no concept of multiple databases

    config = db_cfg.get("config", {})
    if db_type == "postgres":
        import psycopg
        host = config.get("host", "localhost")
        port = config.get("port", 5432)
        user = config.get("username", "")
        pwd = config.get("password", "")
        conninfo = f"host={host} port={port} dbname=postgres user={user} password={pwd} connect_timeout=10"
        with psycopg.connect(conninfo) as pg_conn:
            with pg_conn.cursor() as cur:
                cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
                return [r[0] for r in cur.fetchall()]
    elif db_type == "mysql":
        import pymysql
        host = config.get("host", "localhost")
        port = int(config.get("port", 3306))
        user = config.get("username", "")
        pwd = config.get("password", "")
        my_conn = pymysql.connect(host=host, port=port, user=user, password=pwd, connect_timeout=10)
        try:
            with my_conn.cursor() as cur:
                cur.execute("SHOW DATABASES")
                rows = cur.fetchall()
                # Filter system databases (case-insensitive)
                sys_dbs = {"information_schema", "mysql", "performance_schema", "sys"}
                return [r[0] for r in rows if r[0].lower() not in sys_dbs]
        finally:
            my_conn.close()
    return []


def list_db_tables(db_connection_id: str, *, database: str = "") -> list[str]:
    """List all tables in the target database."""
    db, db_type = _connect_db(db_connection_id, database=database)
    try:
        if db_type == "sqlite":
            rows = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
            return [r[0] for r in rows]
        elif db_type == "postgres":
            cur = db.cursor()
            cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
            result = [r[0] for r in cur.fetchall()]
            cur.close()
            return result
        elif db_type == "mysql":
            cur = db.cursor()
            cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name")
            result = [r[0] for r in cur.fetchall()]
            cur.close()
            return result
        return []
    finally:
        if db_type == "sqlite":
            db.close()
        elif db_type == "postgres":
            db.close()
        elif db_type == "mysql":
            db.close()


def list_table_columns(db_connection_id: str, table_name: str, *, database: str = "") -> list[str]:
    """List all columns in a table."""
    db, db_type = _connect_db(db_connection_id, database=database)
    try:
        if db_type == "sqlite":
            rows = db.execute(f"PRAGMA table_info({table_name})").fetchall()
            return [r[1] for r in rows]
        elif db_type == "postgres":
            cur = db.cursor()
            cur.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s ORDER BY ordinal_position",
                (table_name,),
            )
            result = [r[0] for r in cur.fetchall()]
            cur.close()
            return result
        elif db_type == "mysql":
            cur = db.cursor()
            cur.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=%s ORDER BY ordinal_position",
                (table_name,),
            )
            result = [r[0] for r in cur.fetchall()]
            cur.close()
            return result
        return []
    finally:
        if db_type == "sqlite":
            db.close()
        elif db_type == "postgres":
            db.close()
        elif db_type == "mysql":
            db.close()


def _validate_table_column(db_type: str, db_conn, table_name: str, column_name: str) -> None:
    """Raise ValueError if table or column doesn't exist in the target database."""
    tables = []
    if db_type == "sqlite":
        rows = db_conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
        tables = [r[0] for r in rows]
    elif db_type == "postgres":
        cur = db_conn.cursor()
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
        tables = [r[0] for r in cur.fetchall()]
        cur.close()
    elif db_type == "mysql":
        cur = db_conn.cursor()
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()")
        tables = [r[0] for r in cur.fetchall()]
        cur.close()
    if table_name not in tables:
        raise ValueError(f"表不存在: {table_name}")

    cols = []
    if db_type == "sqlite":
        rows = db_conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        cols = [r[1] for r in rows]
    elif db_type == "postgres":
        cur = db_conn.cursor()
        cur.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s",
            (table_name,),
        )
        cols = [r[0] for r in cur.fetchall()]
        cur.close()
    elif db_type == "mysql":
        cur = db_conn.cursor()
        cur.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=%s",
            (table_name,),
        )
        cols = [r[0] for r in cur.fetchall()]
        cur.close()
    if column_name not in cols:
        raise ValueError(f"字段不存在: {table_name}.{column_name}")


def get_dimension_values(dim_id: str) -> list[str]:
    """Query actual data values from the dimension's source table/column via database_connections."""
    dim = _ensure_conn().execute("SELECT * FROM system_dimension_registry WHERE dim_id=?", (dim_id,)).fetchone()
    if dim is None:
        return []
    try:
        db_conn, db_type = _connect_db(dim["db_connection_id"], database=dim["db_name"] or "")
        table = dim["table_name"]
        column = dim["column_name"]

        # Validate identifiers exist (prevents SQL injection)
        _validate_table_column(db_type, db_conn, table, column)

        q_table = _quote_identifier(table, db_type)
        q_column = _quote_identifier(column, db_type)
        sql = f"SELECT DISTINCT {q_column} FROM {q_table} ORDER BY {q_column} LIMIT 1000"

        try:
            if db_type == "sqlite":
                rows = db_conn.execute(sql).fetchall()
                return [str(r[0]) for r in rows if r[0] is not None]
            else:
                cur = db_conn.cursor()
                cur.execute(sql)
                result = [str(r[0]) for r in cur.fetchall() if r[0] is not None]
                cur.close()
                return result
        finally:
            if db_type == "sqlite":
                db_conn.close()
            elif db_type == "postgres":
                db_conn.close()
            elif db_type == "mysql":
                db_conn.close()
    except Exception:
        return []


# ── MCP Service Versions CRUD ─────────────────────────────────────────

def create_service_version(
    *,
    service_id: str,
    version: str = "",
    version_notes: str = "",
    dimensions: list[str] | None = None,
    tables: list[str] | None = None,
    input_schema: dict[str, Any] | None = None,
    output_schema: dict[str, Any] | None = None,
    submitted_by_agent_id: str = "",
    submitted_by_account: str = "",
) -> dict[str, Any]:
    """Create a new service version record (pending review). Returns the created record."""
    conn = _ensure_conn()
    version_id = f"ver_{uuid.uuid4().hex[:12]}"
    conn.execute(
        """
        INSERT INTO mcp_service_versions (
            version_id, service_id, version, version_notes,
            snapshot_dimensions, snapshot_tables,
            snapshot_input_schema, snapshot_output_schema,
            status, submitted_by_agent_id, submitted_by_account, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'))
        """,
        (
            version_id, service_id, version.strip(), version_notes.strip(),
            json.dumps(dimensions or [], ensure_ascii=False),
            json.dumps(tables or [], ensure_ascii=False),
            json.dumps(input_schema or {}, ensure_ascii=False),
            json.dumps(output_schema or {}, ensure_ascii=False),
            submitted_by_agent_id.strip(), submitted_by_account.strip(),
        ),
    )
    return get_service_version(version_id) or {}


def get_service_version(version_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM mcp_service_versions WHERE version_id = ?", (version_id,)
    ).fetchone()
    return dict(row) if row else None


def list_service_versions(service_id: str) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        "SELECT * FROM mcp_service_versions WHERE service_id = ? ORDER BY submitted_at DESC",
        (service_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_pending_version(service_id: str) -> dict[str, Any] | None:
    """Return the pending version for a service, if any."""
    row = _ensure_conn().execute(
        "SELECT * FROM mcp_service_versions WHERE service_id = ? AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1",
        (service_id,),
    ).fetchone()
    return dict(row) if row else None


def update_service_version_status(
    version_id: str,
    status: str,
    *,
    reviewed_by: str = "",
    review_comment: str = "",
) -> bool:
    conn = _ensure_conn()
    cur = conn.execute(
        """UPDATE mcp_service_versions
           SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_comment = ?
           WHERE version_id = ?""",
        (status.strip(), reviewed_by.strip(), review_comment.strip(), version_id),
    )
    return cur.rowcount > 0


# ── System MCP scanning ──────────────────────────────────────────────

def _scan_system_mcps(conn: sqlite3.Connection) -> None:
    """Scan backend/services/mcp_system/ subdirectories, read manifest.json, INSERT into mcp_services."""
    system_dir = _backend_dir / "services" / "mcp_system"
    if not system_dir.is_dir():
        return

    for entry in sorted(system_dir.iterdir()):
        if not entry.is_dir() or entry.name.startswith("_") or entry.name.startswith("."):
            continue
        manifest_file = entry / "manifest.json"
        if not manifest_file.is_file():
            continue
        try:
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        service_id = f"system-{entry.name}"
        name = manifest.get("name", entry.name)
        description = manifest.get("description", "")
        version = str(manifest.get("version", "1.0.0"))
        conn.execute(
            """INSERT OR IGNORE INTO mcp_services (service_id, name, description, source, status, version)
               VALUES (?, ?, ?, 'system', 'online', ?)""",
            (service_id, name.strip(), description.strip(), version),
        )
