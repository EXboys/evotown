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
            model_policy      TEXT NOT NULL DEFAULT 'all',
            category          TEXT NOT NULL DEFAULT 'employee',
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
    if "model_policy" not in cols:
        conn.execute("ALTER TABLE workspaces ADD COLUMN model_policy TEXT NOT NULL DEFAULT 'all'")
    if "category" not in cols:
        conn.execute("ALTER TABLE workspaces ADD COLUMN category TEXT NOT NULL DEFAULT 'employee'")
    if "template_id" not in cols:
        conn.execute("ALTER TABLE workspaces ADD COLUMN template_id TEXT NOT NULL DEFAULT ''")


def _workspace_from_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    tid = d.get("template_id", "")
    if tid:
        try:
            from infra import agent_templates as at
            tpl = at.resolve_template(tid)
            if tpl:
                d["template_name"] = tpl.get("name", "")
        except Exception:
            pass
    return d


def _copy_mcp_system_files(dev_dir: Path) -> None:
    """Copy database.py, permissions.py, publish.py from mcp-services/ to shared mcp-dev/."""
    from pathlib import Path as _P
    import os as _os

    mcp_services = _P(_os.environ.get("MCP_SERVICES_DIR", "/app/data/mcp-services"))
    for fname in ("database.py", "permissions.py", "publish.py"):
        if fname == "publish.py":
            src = _P(__file__).resolve().parent.parent / "services" / "mcp_publish_script.py"
        else:
            src = mcp_services / fname
        if src.is_file():
            (dev_dir / fname).write_bytes(src.read_bytes())


def _safe_name(value: str) -> str:
    # Allow Unicode letters, digits, spaces, dots, underscores, hyphens
    # Filter out path-dangerous chars: / \ : * ? " < > | \x00
    name = re.sub(r"[/\\:*?\"<>|]+", "-", value.strip())
    name = re.sub(r"\s+", " ", name).strip()
    return name[:80] or "Personal Sandbox"


def _workspace_dir(owner_account_id: str, workspace_id: str) -> Path:
    return workspace_base_dir() / workspace_id


def create_workspace(
    *,
    owner_account_id: str,
    name: str,
    tenant_id: str = "",
    team_id: str = "",
    model_policy: str = "routes_only",
    category: str = "employee",
    template_id: str = "",
) -> dict[str, Any]:
    if not owner_account_id.strip():
        raise ValueError("owner_account_id is required")
    if model_policy not in ("all", "routes_only"):
        raise ValueError("model_policy must be 'all' or 'routes_only'")
    if template_id:
        from infra import agent_templates

        tpl = agent_templates.get_template(template_id)
        if tpl is None and not template_id.startswith("builtin:"):
            raise ValueError(f"template not found: {template_id}")
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
            visibility, status, model_policy, category, template_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'private', 'active', ?, ?, ?, datetime('now'), datetime('now'))
        """,
        (workspace_id, owner_account_id.strip(), tenant_id.strip(), team_id.strip(), resolved_name, workspace_id, model_policy, category, template_id),
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO workspace_members (workspace_id, account_id, role, created_at)
        VALUES (?, ?, 'member', datetime('now'))
        """,
        (workspace_id, owner_account_id.strip()),
    )
    workspace = get_workspace(workspace_id) or {}
    # Apply template profile on creation
    if template_id:
        tpl = _resolve_template(template_id)
        if tpl:
            _upsert_workspace_profile(workspace_id, template_id, tpl)
            # Initialize workspace directory skeleton if template declares one
            if tpl.get("has_workspace_dir"):
                prefix = (tpl.get("workspace_dir_prefix") or "").strip("/")
                dir_root = (tpl.get("workspace_dir_root") or "workspace").strip()

                if dir_root in ("shared", "server"):
                    # Symlink shared server dir into workspace
                    import os as _os2
                    shared_dev = _os2.environ.get("MCP_SERVICES_DIR", "/app/data/mcp-services").replace("mcp-services", "mcp-dev") if "mcp-services" in _os2.environ.get("MCP_SERVICES_DIR", "") else "/app/data/mcp-dev"
                    target = Path(shared_dev)
                    if target.is_dir():
                        link = root / (prefix or "mcp-dev")
                        if not link.exists():
                            link.symlink_to(target, target_is_directory=True)
                else:
                    dev_dir = root / (prefix or "")
                    dev_dir.mkdir(parents=True, exist_ok=True)
                    (dev_dir / "README.md").write_text(
                        f"# {tpl.get('name', 'Workspace')} Development Directory\n\n"
                        "开发目录。Agent 在此目录下创建 MCP/Skill 等代码文件。\n",
                        encoding="utf-8",
                    )
    return workspace


def _resolve_template(template_id: str) -> dict[str, Any] | None:
    """Resolve template by ID from DB."""
    from infra import agent_templates as at
    return at.get_template(template_id)


def _upsert_workspace_profile(workspace_id: str, template_id: str, tpl: dict[str, Any]) -> None:
    """Apply template fields to workspace profile (DB + disk file)."""
    conn = _ensure_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS workspace_profiles (
            workspace_id      TEXT PRIMARY KEY,
            agent_type        TEXT NOT NULL DEFAULT '',
            soul              TEXT NOT NULL DEFAULT '',
            paradigm          TEXT NOT NULL DEFAULT '',
            standards         TEXT NOT NULL DEFAULT '',
            default_model     TEXT NOT NULL DEFAULT '',
            default_skills    TEXT NOT NULL DEFAULT '[]',
            default_mcp       TEXT NOT NULL DEFAULT '[]',
            template_id       TEXT NOT NULL DEFAULT '',
            updated_at        TEXT
        );
        """
    )
    import json

    profile_data = {
        "agent_type": tpl.get("name", ""),
        "soul": tpl.get("soul", ""),
        "paradigm": tpl.get("paradigm", ""),
        "standards": tpl.get("standards", ""),
        "default_model": tpl.get("default_model", ""),
        "default_skills": tpl.get("default_skills", []),
    }
    conn.execute(
        """INSERT OR REPLACE INTO workspace_profiles
           (workspace_id, agent_type, soul, paradigm, standards, default_model, default_skills, default_mcp, template_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, datetime('now'))""",
        (
            workspace_id,
            profile_data["agent_type"],
            profile_data["soul"],
            profile_data["paradigm"],
            profile_data["standards"],
            profile_data["default_model"],
            json.dumps(profile_data["default_skills"]),
            template_id,
        ),
    )

    # Also write profile file to disk so get_profile reads it
    ws = get_workspace(workspace_id)
    if ws:
        ws_root = _workspace_dir(ws.get("owner_account_id", ""), workspace_id)
        profile_path = ws_root / ".evotown" / "profile.json"
        profile_path.parent.mkdir(parents=True, exist_ok=True)
        profile_path.write_text(
            json.dumps(profile_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def list_workspaces(
    *,
    owner_account_id: str | None = None,
    status: str | None = WORKSPACE_STATUS_ACTIVE,
    category: str | None = None,
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
    if category:
        where.append("category=?")
        params.append(category)
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
    model_policy: str | None = None,
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
    if model_policy is not None:
        if model_policy not in ("all", "routes_only"):
            raise ValueError("model_policy must be 'all' or 'routes_only'")
        updates["model_policy"] = model_policy
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
            """
            INSERT INTO workspace_members (workspace_id, account_id, role, created_at)
            VALUES (?, ?, 'member', datetime('now'))
            ON CONFLICT(workspace_id, account_id) DO UPDATE SET role='member'
            """,
            (workspace_id, new_owner),
        )
    workspace = get_workspace(workspace_id)
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
    source = root / relative_path
    target = source.resolve()
    try:
        target.relative_to(root)
    except ValueError:
        # Allow if the path itself or any ancestor is a symlink within workspace
        has_symlink = source.is_symlink()
        if not has_symlink:
            p = source
            while p != root and p.parent != p:
                p = p.parent
                if p.is_symlink():
                    has_symlink = True
                    break
        if not has_symlink:
            raise ValueError("path escapes workspace root") from None
    return target


# ── Workspace ↔ Account bindings (M:N) ─────────────────────────────

def _member_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def bind_account_to_workspace(account_id: str, workspace_id: str) -> dict[str, Any] | None:
    """Bind an account as a member of a workspace. Idempotent."""
    conn = _ensure_conn()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO workspace_members (workspace_id, account_id, role) VALUES (?, ?, 'member')",
            (workspace_id, account_id),
        )
    except sqlite3.IntegrityError:
        return None
    row = conn.execute(
        "SELECT * FROM workspace_members WHERE workspace_id=? AND account_id=?",
        (workspace_id, account_id),
    ).fetchone()
    return _member_from_row(row) if row else None


def unbind_account_from_workspace(account_id: str, workspace_id: str) -> bool:
    """Remove an account from a workspace."""
    conn = _ensure_conn()
    conn.execute(
        "DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",
        (workspace_id, account_id),
    )
    return conn.total_changes > 0


def list_account_workspaces(account_id: str) -> list[dict[str, Any]]:
    """Workspaces this account is a member of."""
    rows = _ensure_conn().execute(
        """
        SELECT w.* FROM workspaces w
        JOIN workspace_members m ON m.workspace_id = w.workspace_id
        WHERE m.account_id=? AND w.status='active'
        ORDER BY w.updated_at DESC
        """,
        (account_id,),
    ).fetchall()
    return [_workspace_from_row(row) for row in rows]


def count_account_workspaces(account_id: str) -> int:
    row = _ensure_conn().execute(
        "SELECT COUNT(*) AS n FROM workspace_members WHERE account_id=?",
        (account_id,),
    ).fetchone()
    return int(row["n"]) if row else 0


def list_workspace_accounts(workspace_id: str) -> list[dict[str, Any]]:
    """Accounts that are members of this workspace."""
    rows = _ensure_conn().execute(
        """
        SELECT m.account_id, m.role, m.created_at AS bound_at
        FROM workspace_members m
        WHERE m.workspace_id=?
        ORDER BY m.created_at DESC
        """,
        (workspace_id,),
    ).fetchall()
    return [dict(row) for row in rows]
