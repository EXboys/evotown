"""Private sandbox agent registry for centrally hosted coding agents."""
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

AGENT_STATUS_ACTIVE = "active"
AGENT_STATUS_ARCHIVED = "archived"


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


def agent_base_dir() -> Path:
    path = Path(os.environ.get("EVOTOWN_AGENTS_DIR", _data_dir() / "agents"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "agents.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS agents (
            agent_id         TEXT PRIMARY KEY,
            owner_account_id TEXT NOT NULL,
            tenant_id        TEXT NOT NULL DEFAULT '',
            team_id          TEXT NOT NULL DEFAULT '',
            name             TEXT NOT NULL,
            agent_type       TEXT NOT NULL DEFAULT 'coding-agent',
            root_path        TEXT NOT NULL,
            visibility       TEXT NOT NULL DEFAULT 'private',
            status           TEXT NOT NULL DEFAULT 'active',
            model_policy     TEXT NOT NULL DEFAULT 'all',
            category         TEXT NOT NULL DEFAULT 'employee',
            template_id      TEXT NOT NULL DEFAULT '',
            key_id           TEXT NOT NULL DEFAULT '',
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_account_id, status);
        CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);

        CREATE TABLE IF NOT EXISTS agent_members (
            agent_id         TEXT NOT NULL,
            account_id       TEXT NOT NULL,
            role             TEXT NOT NULL DEFAULT 'member',
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (agent_id, account_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_members_account ON agent_members(account_id);
        """
    )
    _migrate(conn)
    _conn = conn
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(agents)").fetchall()}
    if "storage_quota_mb" not in cols:
        conn.execute("ALTER TABLE agents ADD COLUMN storage_quota_mb INTEGER NOT NULL DEFAULT 0")
    if "model_policy" not in cols:
        conn.execute("ALTER TABLE agents ADD COLUMN model_policy TEXT NOT NULL DEFAULT 'all'")
    if "category" not in cols:
        conn.execute("ALTER TABLE agents ADD COLUMN category TEXT NOT NULL DEFAULT 'employee'")
    if "template_id" not in cols:
        conn.execute("ALTER TABLE agents ADD COLUMN template_id TEXT NOT NULL DEFAULT ''")
    if "agent_type" not in cols:
        conn.execute("ALTER TABLE agents ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'coding-agent'")
    if "key_id" not in cols:
        conn.execute("ALTER TABLE agents ADD COLUMN key_id TEXT NOT NULL DEFAULT ''")
    if "raw_key" not in cols:
        conn.execute("ALTER TABLE agents ADD COLUMN raw_key TEXT NOT NULL DEFAULT ''")


def _agent_from_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d.pop("raw_key", None)  # never expose raw key in API responses
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


def get_agent_key(agent_id: str) -> str:
    """Return the raw API key for an agent (internal use only).
    Auto-issues a key if none exists yet."""
    conn = _ensure_conn()
    row = conn.execute("SELECT raw_key FROM agents WHERE agent_id=?", (agent_id,)).fetchone()
    if row and row["raw_key"]:
        return str(row["raw_key"])
    # Auto-issue key for agents that don't have one
    name_row = conn.execute("SELECT name FROM agents WHERE agent_id=?", (agent_id,)).fetchone()
    if not name_row:
        return ""
    from infra import accounts as _acct
    raw_key, key_id = _acct.issue_agent_key(agent_id, str(name_row["name"]))
    conn.execute("UPDATE agents SET raw_key=?, key_id=? WHERE agent_id=?", (raw_key, key_id, agent_id))
    conn.commit()
    return raw_key


def _copy_mcp_system_files(dev_dir: Path) -> None:
    """Copy database.py, permissions.py to shared mcp-dev/."""
    mcp_services = Path(os.environ.get("MCP_SERVICES_DIR", "/app/data/mcp-services"))
    for fname in ("database.py", "permissions.py"):
        src = mcp_services / fname
        if src.is_file():
            (dev_dir / fname).write_bytes(src.read_bytes())


def _safe_name(value: str) -> str:
    name = re.sub(r"[/\\:*?\"<>|]+", "-", value.strip())
    name = re.sub(r"\s+", " ", name).strip()
    return name[:80] or "Personal Sandbox"


def _agent_dir(agent_id: str) -> Path:
    return agent_base_dir() / agent_id


def create_agent(
    *,
    owner_account_id: str,
    name: str,
    tenant_id: str = "",
    team_id: str = "",
    model_policy: str = "routes_only",
    category: str = "employee",
    template_id: str = "",
    agent_type: str = "coding-agent",
    key_id: str = "",
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
    agent_id = f"agt_{uuid.uuid4().hex[:16]}"
    root = _agent_dir(agent_id)
    root.mkdir(parents=True, exist_ok=False)
    (root / ".evotown").mkdir(parents=True, exist_ok=True)
    (root / "README.md").write_text(
        "# Evotown Coding Agent Workspace\n\n"
        "This private sandbox is owned by the bound account.\n",
        encoding="utf-8",
    )

    conn = _ensure_conn()
    resolved_name = _safe_name(name)
    conn.execute(
        """
        INSERT INTO agents (
            agent_id, owner_account_id, tenant_id, team_id, name, agent_type, root_path,
            visibility, status, model_policy, category, template_id, key_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'private', 'active', ?, ?, ?, ?, datetime('now'), datetime('now'))
        """,
        (agent_id, owner_account_id.strip(), tenant_id.strip(), team_id.strip(),
         resolved_name, agent_type, agent_id, model_policy, category, template_id, key_id),
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO agent_members (agent_id, account_id, role, created_at)
        VALUES (?, ?, 'member', datetime('now'))
        """,
        (agent_id, owner_account_id.strip()),
    )
    agent = get_agent(agent_id) or {}
    if template_id:
        tpl = _resolve_template(template_id)
        if tpl:
            _upsert_agent_profile(agent_id, template_id, tpl)
            if tpl.get("has_agent_dir"):
                prefix = (tpl.get("agent_dir_prefix") or "").strip("/")
                dir_root = (tpl.get("agent_dir_root") or "workspace").strip()
                if dir_root in ("shared", "server"):
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
                        f"# {tpl.get('name', 'Agent')} Development Directory\n\n"
                        "开发目录。Agent 在此目录下创建 MCP/Skill 等代码文件。\n",
                        encoding="utf-8",
                    )
    if not agent.get("key_id"):
        from infra import accounts as acct
        raw_key, key_id = acct.issue_agent_key(agent_id, name)
        _ensure_conn().execute(
            "UPDATE agents SET key_id=?, raw_key=? WHERE agent_id=?",
            (key_id, raw_key, agent_id),
        )
    return agent


def _resolve_template(template_id: str) -> dict[str, Any] | None:
    from infra import agent_templates as at
    return at.get_template(template_id)


def _upsert_agent_profile(agent_id: str, template_id: str, tpl: dict[str, Any]) -> None:
    conn = _ensure_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS agent_profiles (
            agent_id         TEXT PRIMARY KEY,
            agent_type       TEXT NOT NULL DEFAULT '',
            soul             TEXT NOT NULL DEFAULT '',
            paradigm         TEXT NOT NULL DEFAULT '',
            standards        TEXT NOT NULL DEFAULT '',
            default_model    TEXT NOT NULL DEFAULT '',
            default_skills   TEXT NOT NULL DEFAULT '[]',
            default_mcp      TEXT NOT NULL DEFAULT '[]',
            template_id      TEXT NOT NULL DEFAULT '',
            updated_at       TEXT
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
        """INSERT OR REPLACE INTO agent_profiles
           (agent_id, agent_type, soul, paradigm, standards, default_model, default_skills, default_mcp, template_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, datetime('now'))""",
        (agent_id, profile_data["agent_type"], profile_data["soul"], profile_data["paradigm"],
         profile_data["standards"], profile_data["default_model"], json.dumps(profile_data["default_skills"]), template_id),
    )
    ag = get_agent(agent_id)
    if ag:
        ag_root = _agent_dir(agent_id)
        profile_path = ag_root / ".evotown" / "profile.json"
        profile_path.parent.mkdir(parents=True, exist_ok=True)
        profile_path.write_text(json.dumps(profile_data, ensure_ascii=False, indent=2), encoding="utf-8")


def list_agents(
    *,
    owner_account_id: str | None = None,
    status: str | None = AGENT_STATUS_ACTIVE,
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
        f"SELECT * FROM agents {clause} ORDER BY updated_at DESC, created_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_agent_from_row(row) for row in rows]


def get_agent(agent_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM agents WHERE agent_id=?",
        (agent_id,),
    ).fetchone()
    return _agent_from_row(row) if row else None


def update_agent(
    agent_id: str,
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
        if status not in {AGENT_STATUS_ACTIVE, AGENT_STATUS_ARCHIVED}:
            raise ValueError("invalid agent status")
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
        return get_agent(agent_id)

    conn = _ensure_conn()
    sets = ", ".join(f"{key}=?" for key in updates)
    values = list(updates.values()) + [agent_id]
    conn.execute(
        f"UPDATE agents SET {sets}, updated_at=datetime('now') WHERE agent_id=?",
        values,
    )
    if "owner_account_id" in updates:
        new_owner = updates["owner_account_id"]
        conn.execute(
            """
            INSERT INTO agent_members (agent_id, account_id, role, created_at)
            VALUES (?, ?, 'member', datetime('now'))
            ON CONFLICT(agent_id, account_id) DO UPDATE SET role='member'
            """,
            (agent_id, new_owner),
        )
    return get_agent(agent_id)


def agent_usage_bytes(agent: dict[str, Any]) -> int:
    """Best-effort recursive size of the agent directory in bytes."""
    root = Path(str(agent.get("root_path") or ""))
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


def is_agent_member(agent_id: str, account_id: str) -> bool:
    if not agent_id or not account_id:
        return False
    row = _ensure_conn().execute(
        "SELECT 1 FROM agent_members WHERE agent_id=? AND account_id=?",
        (agent_id, account_id),
    ).fetchone()
    return row is not None


def can_access_agent(agent: dict[str, Any] | None, identity: dict[str, Any]) -> bool:
    if agent is None:
        return False
    if "*" in (identity.get("scopes") or []):
        return True
    account_id = str(identity.get("account_id") or "")
    return bool(account_id and agent.get("owner_account_id") == account_id)


def can_run_agent(agent: dict[str, Any] | None, identity: dict[str, Any]) -> bool:
    if not can_access_agent(agent, identity):
        return False
    scopes = identity.get("scopes") or []
    return "*" in scopes or "agent.run" in scopes or "console.write" in scopes


def resolve_agent_path(agent: dict[str, Any], relative_path: str = ".") -> Path:
    base = agent_base_dir()
    root = (base / str(agent["root_path"])).resolve()
    source = root / relative_path
    target = source.resolve()
    try:
        target.relative_to(root)
    except ValueError:
        has_symlink = source.is_symlink()
        if not has_symlink:
            p = source
            while p != root and p.parent != p:
                p = p.parent
                if p.is_symlink():
                    has_symlink = True
                    break
        if not has_symlink:
            raise ValueError("path escapes agent root") from None
    return target


# ── Agent ↔ Account bindings (M:N) ─────────────────────────────

def bind_account_to_agent(account_id: str, agent_id: str) -> dict[str, Any] | None:
    conn = _ensure_conn()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO agent_members (agent_id, account_id, role) VALUES (?, ?, 'member')",
            (agent_id, account_id),
        )
    except sqlite3.IntegrityError:
        return None
    row = conn.execute(
        "SELECT * FROM agent_members WHERE agent_id=? AND account_id=?",
        (agent_id, account_id),
    ).fetchone()
    return dict(row) if row else None


def unbind_account_from_agent(account_id: str, agent_id: str) -> bool:
    conn = _ensure_conn()
    conn.execute(
        "DELETE FROM agent_members WHERE agent_id=? AND account_id=?",
        (agent_id, account_id),
    )
    return conn.total_changes > 0


def list_account_agents(account_id: str) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        """
        SELECT a.* FROM agents a
        JOIN agent_members m ON m.agent_id = a.agent_id
        WHERE m.account_id=? AND a.status='active'
        ORDER BY a.updated_at DESC
        """,
        (account_id,),
    ).fetchall()
    return [_agent_from_row(row) for row in rows]


def count_account_agents(account_id: str) -> int:
    row = _ensure_conn().execute(
        "SELECT COUNT(*) AS n FROM agent_members WHERE account_id=?",
        (account_id,),
    ).fetchone()
    return int(row["n"]) if row else 0


def list_agent_accounts(agent_id: str) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        """
        SELECT m.account_id, m.role, m.created_at AS bound_at
        FROM agent_members m
        WHERE m.agent_id=?
        ORDER BY m.created_at DESC
        """,
        (agent_id,),
    ).fetchall()
    return [dict(row) for row in rows]
