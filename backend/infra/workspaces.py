"""Private sandbox workspace registry for centrally hosted coding agents."""
from __future__ import annotations

import os
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"

_conn: sqlite3.Connection | None = None

WORKSPACE_STATUS_ACTIVE = "active"
WORKSPACE_STATUS_ARCHIVED = "archived"


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


def workspace_base_dir() -> Path:
    path = Path(os.environ.get("EVOTOWN_WORKSPACES_DIR", _data_dir() / "workspaces"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "workspaces.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS workspaces (
            workspace_id      TEXT PRIMARY KEY,
            owner_account_id  TEXT NOT NULL,
            tenant_id         TEXT NOT NULL DEFAULT '',
            team_id           TEXT NOT NULL DEFAULT '',
            name              TEXT NOT NULL,
            root_path         TEXT NOT NULL,
            visibility        TEXT NOT NULL DEFAULT 'private',
            status            TEXT NOT NULL DEFAULT 'active',
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_account_id, status);
        CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);

        CREATE TABLE IF NOT EXISTS workspace_members (
            workspace_id      TEXT NOT NULL,
            account_id        TEXT NOT NULL,
            role              TEXT NOT NULL DEFAULT 'owner',
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (workspace_id, account_id)
        );
        CREATE INDEX IF NOT EXISTS idx_workspace_members_account ON workspace_members(account_id);
        """
    )
    _migrate(conn)
    _conn = conn
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(workspaces)").fetchall()}
    if "storage_quota_mb" not in cols:
        conn.execute("ALTER TABLE workspaces ADD COLUMN storage_quota_mb INTEGER NOT NULL DEFAULT 0")


def _workspace_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def _safe_name(value: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9._ -]+", "-", value.strip())
    name = re.sub(r"\s+", " ", name).strip(" .-")
    return name[:80] or "Personal Sandbox"


def _workspace_dir(owner_account_id: str, workspace_id: str) -> Path:
    return workspace_base_dir() / owner_account_id / workspace_id


def create_workspace(
    *,
    owner_account_id: str,
    name: str,
    tenant_id: str = "",
    team_id: str = "",
) -> dict[str, Any]:
    if not owner_account_id.strip():
        raise ValueError("owner_account_id is required")
    workspace_id = f"ws_{uuid.uuid4().hex[:16]}"
    root = _workspace_dir(owner_account_id.strip(), workspace_id)
    root.mkdir(parents=True, exist_ok=False)
    (root / ".evotown").mkdir(parents=True, exist_ok=True)
    (root / "README.md").write_text(
        "# Evotown Coding Agent Workspace\n\n"
        "This private sandbox is owned by the bound account. Public skills and knowledge "
        "context are mounted under `.evotown/` for each run.\n",
        encoding="utf-8",
    )

    conn = _ensure_conn()
    resolved_name = _safe_name(name)
    conn.execute(
        """
        INSERT INTO workspaces (
            workspace_id, owner_account_id, tenant_id, team_id, name, root_path,
            visibility, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'private', 'active', datetime('now'), datetime('now'))
        """,
        (workspace_id, owner_account_id.strip(), tenant_id.strip(), team_id.strip(), resolved_name, str(root)),
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO workspace_members (workspace_id, account_id, role, created_at)
        VALUES (?, ?, 'owner', datetime('now'))
        """,
        (workspace_id, owner_account_id.strip()),
    )
    workspace = get_workspace(workspace_id) or {}
    if workspace:
        from infra import hosted_workspace_engines

        hosted_workspace_engines.register_workspace_engine(workspace)
    return workspace


def list_workspaces(
    *,
    owner_account_id: str | None = None,
    status: str | None = WORKSPACE_STATUS_ACTIVE,
    limit: int = 100,
) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    where: list[str] = []
    params: list[Any] = []
    if owner_account_id:
        where.append("owner_account_id=?")
        params.append(owner_account_id)
    if status:
        where.append("status=?")
        params.append(status)
    params.append(max(1, min(limit, 500)))
    clause = "WHERE " + " AND ".join(where) if where else ""
    rows = conn.execute(
        f"SELECT * FROM workspaces {clause} ORDER BY updated_at DESC, created_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_workspace_from_row(row) for row in rows]


def get_workspace(workspace_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM workspaces WHERE workspace_id=?",
        (workspace_id,),
    ).fetchone()
    return _workspace_from_row(row) if row else None


def update_workspace(
    workspace_id: str,
    *,
    name: str | None = None,
    status: str | None = None,
    owner_account_id: str | None = None,
    storage_quota_mb: int | None = None,
) -> dict[str, Any] | None:
    updates: dict[str, Any] = {}
    if name is not None:
        updates["name"] = _safe_name(name)
    if status is not None:
        if status not in {WORKSPACE_STATUS_ACTIVE, WORKSPACE_STATUS_ARCHIVED}:
            raise ValueError("invalid workspace status")
        updates["status"] = status
    if owner_account_id is not None:
        new_owner = owner_account_id.strip()
        if not new_owner:
            raise ValueError("owner_account_id cannot be empty")
        updates["owner_account_id"] = new_owner
    if storage_quota_mb is not None:
        if storage_quota_mb < 0:
            raise ValueError("storage_quota_mb cannot be negative")
        updates["storage_quota_mb"] = int(storage_quota_mb)
    if not updates:
        return get_workspace(workspace_id)

    conn = _ensure_conn()
    sets = ", ".join(f"{key}=?" for key in updates)
    values = list(updates.values()) + [workspace_id]
    conn.execute(
        f"UPDATE workspaces SET {sets}, updated_at=datetime('now') WHERE workspace_id=?",
        values,
    )
    if "owner_account_id" in updates:
        new_owner = updates["owner_account_id"]
        conn.execute(
            "UPDATE workspace_members SET role='member' WHERE workspace_id=? AND role='owner'",
            (workspace_id,),
        )
        conn.execute(
            """
            INSERT INTO workspace_members (workspace_id, account_id, role, created_at)
            VALUES (?, ?, 'owner', datetime('now'))
            ON CONFLICT(workspace_id, account_id) DO UPDATE SET role='owner'
            """,
            (workspace_id, new_owner),
        )
    workspace = get_workspace(workspace_id)
    if workspace is not None:
        from infra import hosted_workspace_engines

        hosted_workspace_engines.sync_workspace_engine(workspace)
    return workspace


def workspace_usage_bytes(workspace: dict[str, Any]) -> int:
    """Best-effort recursive size of the workspace directory in bytes."""
    root = Path(str(workspace.get("root_path") or ""))
    if not root.is_dir():
        return 0
    total = 0
    for path in root.rglob("*"):
        try:
            if path.is_file() and not path.is_symlink():
                total += path.stat().st_size
        except OSError:
            continue
    return total


def is_workspace_member(workspace_id: str, account_id: str) -> bool:
    if not workspace_id or not account_id:
        return False
    row = _ensure_conn().execute(
        "SELECT 1 FROM workspace_members WHERE workspace_id=? AND account_id=?",
        (workspace_id, account_id),
    ).fetchone()
    return row is not None


def can_access_workspace(workspace: dict[str, Any] | None, identity: dict[str, Any]) -> bool:
    if workspace is None:
        return False
    if "*" in (identity.get("scopes") or []):
        return True
    account_id = str(identity.get("account_id") or "")
    return bool(account_id and workspace.get("owner_account_id") == account_id)


def can_run_workspace(workspace: dict[str, Any] | None, identity: dict[str, Any]) -> bool:
    if not can_access_workspace(workspace, identity):
        return False
    scopes = identity.get("scopes") or []
    return "*" in scopes or "agent.run" in scopes or "workspace.write" in scopes or "console.write" in scopes


def resolve_workspace_path(workspace: dict[str, Any], relative_path: str = ".") -> Path:
    base = workspace_base_dir()
    root = (base / str(workspace["root_path"])).resolve()
    target = (root / relative_path).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("path escapes workspace root") from exc
    return target
