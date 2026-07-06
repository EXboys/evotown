"""Per-agent skill assignment persistence.

Stores which skills (from the skill market/catalog) are assigned to each
agent, and deploys skill files to the agent's .skills/ directory.
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
    conn = sqlite3.connect(str(data_dir / "agent_skills.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS agent_skills (
            agent_id    TEXT NOT NULL,
            skill_id    TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (agent_id, skill_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id);
        """
    )
    _conn = conn
    return conn


def assign(agent_id: str, skill_ids: list[str]) -> None:
    """Replace the full skill list for one agent."""
    conn = _ensure_conn()
    conn.execute("DELETE FROM agent_skills WHERE agent_id=?", (agent_id,))
    for sid in skill_ids:
        sid = sid.strip()
        if sid:
            conn.execute(
                "INSERT OR IGNORE INTO agent_skills (agent_id, skill_id) VALUES (?, ?)",
                (agent_id, sid),
            )


def revoke(agent_id: str, skill_id: str) -> None:
    """Remove a single skill from an agent."""
    conn = _ensure_conn()
    conn.execute("DELETE FROM agent_skills WHERE agent_id=? AND skill_id=?", (agent_id, skill_id.strip()))


def list_for_agent(agent_id: str) -> list[str]:
    """Return skill_ids assigned to this agent."""
    conn = _ensure_conn()
    rows = conn.execute(
        "SELECT skill_id FROM agent_skills WHERE agent_id=? ORDER BY skill_id", (agent_id,)
    ).fetchall()
    return [r["skill_id"] for r in rows]


def list_agents_for_skill(skill_id: str) -> list[str]:
    """Return agent_ids that have this skill."""
    conn = _ensure_conn()
    rows = conn.execute(
        "SELECT agent_id FROM agent_skills WHERE skill_id=? ORDER BY agent_id", (skill_id.strip(),)
    ).fetchall()
    return [r["agent_id"] for r in rows]


def deploy_skill_to_agent_workspace(
    skill_id: str,
    agent_id: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Copy skill files to agent's .skills/ directory.

    Returns ``{"deployed": bool, "skipped": bool, "version": str, "reason": str}``.
    """
    import shutil
    import zipfile
    import yaml

    from infra import agents as agents_store, skill_market

    agent = agents_store.get_agent(agent_id)
    if agent is None:
        return {"deployed": False, "skipped": False, "version": "", "reason": "agent not found"}

    root = agents_store.resolve_agent_path(agent)
    dest = root / ".skills" / skill_id

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
                if content.startswith("---"):
                    parts = content.split("---", 2)
                    if len(parts) >= 3:
                        fm = yaml.safe_load(parts[1]) or {}
                        installed_version = str(fm.get("version", "")).strip()
                        if installed_version and installed_version != market_version:
                            return {
                                "deployed": False,
                                "skipped": True,
                                "version": installed_version,
                                "reason": f"agent version {installed_version} differs from market {market_version} (use force to overwrite)",
                            }
            except Exception:
                pass

    # Remove old and copy new
    if dest.exists():
        shutil.rmtree(dest)

    # Source: arena_skills, custom-skills, or package
    copied = False
    src = skill_market._builtin_skill_source(skill_id)
    if src is not None:
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
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


def set_agent_skills(
    agent_id: str,
    skill_ids: list[str],
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Assign skills to an agent (DB binding + file deployment)."""
    # 1. DB assignment
    assign(agent_id, skill_ids)

    # 2. Deploy files
    results: list[dict[str, Any]] = []
    for sid in skill_ids:
        r = deploy_skill_to_agent_workspace(sid, agent_id, force=force)
        results.append({"skill_id": sid, **r})

    return {
        "agent_id": agent_id,
        "skills": list_for_agent(agent_id),
        "deploy_results": results,
    }
