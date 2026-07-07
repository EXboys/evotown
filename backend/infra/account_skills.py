"""Per-account skill assignment persistence.

Stores which skills (from the skill market/catalog) are assigned to each
gateway account, so the hosted Coding Agent can selectively mount them.
"""

from __future__ import annotations

import os, sqlite3
from pathlib import Path
from typing import Any

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


_conn: sqlite3.Connection | None = None


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "account_skills.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS account_skills (
            account_id  TEXT NOT NULL,
            skill_id    TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (account_id, skill_id)
        );
        CREATE INDEX IF NOT EXISTS idx_account_skills_account ON account_skills(account_id);
        """
    )
    _conn = conn
    return conn


def assign(account_id: str, skill_ids: list[str]) -> None:
    """Replace the full skill list for one account."""
    conn = _ensure_conn()
    conn.execute("DELETE FROM account_skills WHERE account_id=?", (account_id,))
    for sid in skill_ids:
        sid = sid.strip()
        if sid:
            conn.execute(
                "INSERT OR IGNORE INTO account_skills (account_id, skill_id) VALUES (?, ?)",
                (account_id, sid),
            )


def revoke(account_id: str, skill_id: str) -> None:
    """Remove a single skill from an account."""
    conn = _ensure_conn()
    conn.execute("DELETE FROM account_skills WHERE account_id=? AND skill_id=?", (account_id, skill_id.strip()))


def list_for_account(account_id: str) -> list[str]:
    """Return skill_ids assigned to this account."""
    conn = _ensure_conn()
    rows = conn.execute("SELECT skill_id FROM account_skills WHERE account_id=? ORDER BY skill_id", (account_id,)).fetchall()
    return [r["skill_id"] for r in rows]


def list_accounts_for_skill(skill_id: str) -> list[str]:
    """Return account_ids that have this skill."""
    conn = _ensure_conn()
    rows = conn.execute("SELECT account_id FROM account_skills WHERE skill_id=? ORDER BY account_id", (skill_id.strip(),)).fetchall()
    return [r["account_id"] for r in rows]


def deploy_skill_to_agent_workspace(
    skill_id: str,
    agent_id: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Copy skill files to agent's .evotown/skills/ directory.

    Returns ``{"deployed": bool, "skipped": bool, "version": str, "reason": str}``.
    If ``force=False`` and the agent has a different version already installed,
    the deploy is skipped.
    """
    import shutil
    import zipfile
    import yaml

    from infra import agents as agents_store, skill_market

    agent = agents_store.get_agent(agent_id)
    if agent is None:
        return {"deployed": False, "skipped": False, "version": "", "reason": "agent not found"}

    root = agents_store.resolve_agent_path(agent)
    dest = root / ".evotown" / "skills" / skill_id

    # Read market version
    skill = skill_market.get_skill(skill_id)
    market_version = (skill.get("version") or "").strip() if skill else ""
    if not market_version:
        return {"deployed": False, "skipped": False, "version": "", "reason": "skill not found in market"}

    # Check agent's current version
    if dest.is_dir() and not force:
        skill_md = dest / "SKILL.md"
        if skill_md.is_file():
            try:
                content = skill_md.read_text(encoding="utf-8")
                # Parse YAML frontmatter
                if content.startswith("---"):
                    parts = content.split("---", 2)
                    if len(parts) >= 3:
                        fm = yaml.safe_load(parts[1]) or {}
                        installed_version = str(fm.get("version", "")).strip()
                        if installed_version and installed_version != market_version:
                            return {
                                "deployed": False, "skipped": True,
                                "version": installed_version,
                                "reason": f"agent version {installed_version} differs from market {market_version} (use force to overwrite)",
                            }
            except Exception:
                pass  # can't read version, proceed with deploy

    # Remove old and copy new
    if dest.exists():
        shutil.rmtree(dest)

    # Source: arena_skills or package
    copied = False
    arena_src = skill_market._arena_skills_dir() / skill_id
    if arena_src.is_dir() and (arena_src / "SKILL.md").is_file():
        shutil.copytree(arena_src, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        copied = True
    else:
        package = skill_market.resolve_download_package(skill_id)
        if package is not None:
            zip_path, _filename = package
            dest.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(dest)
            copied = True

    if not copied:
        return {"deployed": False, "skipped": False, "version": "", "reason": "skill source not found"}

    return {"deployed": True, "skipped": False, "version": market_version, "reason": "ok"}


def deploy_skills_to_agents(
    account_id: str,
    skill_ids: list[str],
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Assign skills to an account AND deploy files to all agent workspaces."""
    from infra import agents as agents_store

    # 1. DB assignment
    assign(account_id, skill_ids)

    # 2. Find all agents under this account
    agents_list = agents_store.list_agents(
        member_account_id=account_id,
        owner_account_id=account_id,
        limit=200,
    )
    agent_ids = [a["agent_id"] for a in agents_list]

    # 3. Deploy files to each agent
    results: dict[str, list[dict[str, Any]]] = {}
    for agent_id in agent_ids:
        agent_results = []
        for sid in skill_ids:
            r = deploy_skill_to_agent_workspace(sid, agent_id, force=force)
            agent_results.append({"skill_id": sid, **r})
        results[agent_id] = agent_results

    return {
        "account_id": account_id,
        "skills": list_for_account(account_id),
        "deploy_results": results,
    }
