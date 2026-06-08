"""Enterprise database connection registry and employee access grants.

Evotown stores connection metadata and ACL only. Actual queries go through
per-database MCP proxy services — skills must not hold connection strings.
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Literal

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


_conn: sqlite3.Connection | None = None

DbType = Literal["postgres", "mysql", "sqlite", "mssql"]
AccessMode = Literal["mcp_only"]
PrincipalType = Literal["account", "org", "team"]
DbPermission = Literal["read", "write", "admin"]

_PERMISSION_RANK = {"read": 1, "write": 2, "admin": 3}


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "database_registry.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS database_connections (
            connection_id   TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            db_type         TEXT NOT NULL,
            tenant_id       TEXT NOT NULL DEFAULT '',
            team_id         TEXT NOT NULL DEFAULT '',
            config_json     TEXT NOT NULL DEFAULT '{}',
            mcp_server_url  TEXT NOT NULL DEFAULT '',
            access_mode     TEXT NOT NULL DEFAULT 'mcp_only',
            status          TEXT NOT NULL DEFAULT 'active',
            description     TEXT NOT NULL DEFAULT '',
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_db_connections_status ON database_connections(status);
        CREATE INDEX IF NOT EXISTS idx_db_connections_team ON database_connections(team_id);

        CREATE TABLE IF NOT EXISTS database_access_grants (
            grant_id        TEXT PRIMARY KEY,
            connection_id   TEXT NOT NULL,
            principal_type  TEXT NOT NULL,
            principal_id    TEXT NOT NULL,
            permission      TEXT NOT NULL DEFAULT 'read',
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (connection_id) REFERENCES database_connections(connection_id)
        );
        CREATE INDEX IF NOT EXISTS idx_db_grants_connection ON database_access_grants(connection_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_db_grants_unique
            ON database_access_grants(connection_id, principal_type, principal_id);
        """
    )
    _conn = conn
    return conn


def _json_loads(raw: str, default: Any) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _mask_secret(value: str) -> str:
    text = (value or "").strip()
    if len(text) <= 4:
        return "****" if text else ""
    return f"…{text[-4:]}"


def _public_config(config: dict[str, Any]) -> dict[str, Any]:
    public = dict(config)
    password = str(public.pop("password", "") or "")
    public["password_hint"] = _mask_secret(password)
    public["password_set"] = bool(password)
    return public


def _connection_row(row: sqlite3.Row, *, include_secrets: bool = False) -> dict[str, Any]:
    config = _json_loads(row["config_json"], {})
    item: dict[str, Any] = {
        "connection_id": row["connection_id"],
        "name": row["name"],
        "db_type": row["db_type"],
        "tenant_id": row["tenant_id"],
        "team_id": row["team_id"],
        "mcp_server_url": row["mcp_server_url"],
        "access_mode": row["access_mode"],
        "status": row["status"],
        "description": row["description"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if include_secrets:
        item["config"] = config
    else:
        item["config"] = _public_config(config)
    return item


def _grant_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "grant_id": row["grant_id"],
        "connection_id": row["connection_id"],
        "principal_type": row["principal_type"],
        "principal_id": row["principal_id"],
        "permission": row["permission"],
        "created_at": row["created_at"],
    }


def list_connections(*, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    rows = conn.execute(
        f"SELECT * FROM database_connections {where} ORDER BY updated_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_connection_row(row) for row in rows]


def get_connection(connection_id: str, *, include_secrets: bool = False) -> dict[str, Any] | None:
    conn = _ensure_conn()
    row = conn.execute("SELECT * FROM database_connections WHERE connection_id = ?", (connection_id,)).fetchone()
    return _connection_row(row, include_secrets=include_secrets) if row else None


def create_connection(body: Any) -> dict[str, Any]:
    conn = _ensure_conn()
    config = dict(body.config)
    conn.execute(
        """
        INSERT INTO database_connections (
            connection_id, name, db_type, tenant_id, team_id,
            config_json, mcp_server_url, access_mode, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'mcp_only', 'active', ?)
        """,
        (
            body.connection_id,
            body.name,
            body.db_type,
            body.tenant_id,
            body.team_id,
            json.dumps(config, ensure_ascii=False),
            body.mcp_server_url,
            body.description,
        ),
    )
    return get_connection(body.connection_id) or {}


def update_connection(connection_id: str, body: Any) -> dict[str, Any] | None:
    conn = _ensure_conn()
    existing = get_connection(connection_id, include_secrets=True)
    if existing is None:
        return None
    fields: dict[str, Any] = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.tenant_id is not None:
        fields["tenant_id"] = body.tenant_id
    if body.team_id is not None:
        fields["team_id"] = body.team_id
    if body.mcp_server_url is not None:
        fields["mcp_server_url"] = body.mcp_server_url
    if body.status is not None:
        fields["status"] = body.status
    if body.description is not None:
        fields["description"] = body.description
    if body.config is not None:
        merged = dict(existing["config"])
        merged.update(body.config)
        if not str(merged.get("password") or "").strip() and existing["config"].get("password"):
            merged["password"] = existing["config"]["password"]
        fields["config_json"] = json.dumps(merged, ensure_ascii=False)
    if not fields:
        return get_connection(connection_id)
    assignments = ", ".join(f"{key} = ?" for key in fields) + ", updated_at = datetime('now')"
    values = list(fields.values())
    conn.execute(
        f"UPDATE database_connections SET {assignments} WHERE connection_id = ?",
        (*values, connection_id),
    )
    return get_connection(connection_id)


def delete_connection(connection_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute("DELETE FROM database_connections WHERE connection_id = ?", (connection_id,))
    conn.execute("DELETE FROM database_access_grants WHERE connection_id = ?", (connection_id,))
    return cur.rowcount > 0


def list_grants(*, connection_id: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    if connection_id:
        rows = conn.execute(
            "SELECT * FROM database_access_grants WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?",
            (connection_id, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM database_access_grants ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_grant_row(row) for row in rows]


def create_grant(body: Any) -> dict[str, Any]:
    conn = _ensure_conn()
    if get_connection(body.connection_id) is None:
        raise ValueError("connection not found")
    grant_id = f"grant_{uuid.uuid4().hex[:12]}"
    conn.execute(
        """
        INSERT INTO database_access_grants (
            grant_id, connection_id, principal_type, principal_id, permission
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (grant_id, body.connection_id, body.principal_type, body.principal_id, body.permission),
    )
    row = conn.execute("SELECT * FROM database_access_grants WHERE grant_id = ?", (grant_id,)).fetchone()
    return _grant_row(row) if row else {}


def delete_grant(grant_id: str) -> bool:
    conn = _ensure_conn()
    cur = conn.execute("DELETE FROM database_access_grants WHERE grant_id = ?", (grant_id,))
    return cur.rowcount > 0


def _identity_principals(identity: dict[str, Any]) -> list[tuple[str, str]]:
    principals: list[tuple[str, str]] = []
    account_id = str(identity.get("account_id") or "").strip()
    org_id = str(identity.get("org_id") or identity.get("team_id") or "").strip()
    team_id = str(identity.get("team_id") or "").strip()
    if account_id:
        principals.append(("account", account_id))
    if org_id:
        principals.append(("org", org_id))
    if team_id and team_id != org_id:
        principals.append(("team", team_id))
    return principals


def _grant_matches(identity: dict[str, Any], grant: dict[str, Any]) -> bool:
    for principal_type, principal_id in _identity_principals(identity):
        if grant["principal_type"] == principal_type and grant["principal_id"] == principal_id:
            return True
    return False


def effective_permission(connection_id: str, identity: dict[str, Any]) -> DbPermission | None:
    grants = list_grants(connection_id=connection_id)
    best: DbPermission | None = None
    for grant in grants:
        if not _grant_matches(identity, grant):
            continue
        perm = grant["permission"]
        if best is None or _PERMISSION_RANK[perm] > _PERMISSION_RANK[best]:
            best = perm
    return best


def list_accessible_connections(identity: dict[str, Any], *, limit: int = 100) -> list[dict[str, Any]]:
    connections = list_connections(status="active", limit=limit)
    accessible: list[dict[str, Any]] = []
    for item in connections:
        perm = effective_permission(item["connection_id"], identity)
        if perm is None:
            continue
        accessible.append(
            {
                "connection_id": item["connection_id"],
                "name": item["name"],
                "db_type": item["db_type"],
                "mcp_server_url": item["mcp_server_url"],
                "access_mode": item["access_mode"],
                "permission": perm,
                "team_id": item["team_id"],
            }
        )
    return accessible


def registry_stats() -> dict[str, Any]:
    conn = _ensure_conn()
    total = conn.execute("SELECT COUNT(*) AS c FROM database_connections").fetchone()["c"]
    active = conn.execute("SELECT COUNT(*) AS c FROM database_connections WHERE status='active'").fetchone()["c"]
    grants = conn.execute("SELECT COUNT(*) AS c FROM database_access_grants").fetchone()["c"]
    by_type_rows = conn.execute(
        "SELECT db_type, COUNT(*) AS c FROM database_connections GROUP BY db_type"
    ).fetchall()
    return {
        "total_connections": total,
        "active_connections": active,
        "total_grants": grants,
        "by_db_type": {row["db_type"]: row["c"] for row in by_type_rows},
    }
