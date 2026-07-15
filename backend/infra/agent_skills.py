"""Per-agent skill assignment persistence.

Stores which skills (from the skill market/catalog) are assigned to each
agent, and deploys skill files to the agent's .skills/ directory.

Dependency resolution: skills declare ``requires_skills`` in their version
metadata.  ``set_agent_skills`` expands the assignment into the full
transitive closure so agents always receive every skill they need.
``list_for_agent_with_deps`` resolves dependencies at read time for
contexts that only query the DB (e.g. the coding-agent chat page).
"""

from __future__ import annotations

import json, os, sqlite3
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
    """Return directly-assigned skill_ids (no dependency expansion)."""
    conn = _ensure_conn()
    rows = conn.execute(
        "SELECT skill_id FROM agent_skills WHERE agent_id=? ORDER BY skill_id", (agent_id,)
    ).fetchall()
    return [r["skill_id"] for r in rows]


# ── Dependency resolution ────────────────────────────────────────────────

_MAX_DEP_DEPTH = 10


def _resolve_dependencies(
    skill_ids: list[str],
    *,
    _depth: int = 0,
    _visited: set[str] | None = None,
) -> list[str]:
    """BFS-resolve transitive ``requires_skills`` dependencies.

    Returns a deduplicated, topologically-ordered list: direct skills
    first, then their deps, then transitive deps.
    """
    if _visited is None:
        _visited = set()
    if _depth > _MAX_DEP_DEPTH:
        return []

    from infra import skill_market

    result: list[str] = []
    for sid in skill_ids:
        sid = sid.strip()
        if not sid or sid in _visited:
            continue
        _visited.add(sid)
        result.append(sid)

        ver = skill_market.get_latest_skill_version(sid)
        deps: list[str] = []
        if ver:
            deps_raw = ver.get("requires_skills", "[]")
            if isinstance(deps_raw, str):
                try:
                    deps = json.loads(deps_raw)
                except json.JSONDecodeError:
                    deps = []
            elif isinstance(deps_raw, list):
                deps = deps_raw
        if deps:
            sub = _resolve_dependencies(deps, _depth=_depth + 1, _visited=_visited)
            result.extend(sub)

    return result


def list_for_agent_with_deps(agent_id: str) -> list[str]:
    """Return assigned skill_ids including all transitive dependencies."""
    direct = list_for_agent(agent_id)
    return _resolve_dependencies(direct)


# ── Agent query helpers ──────────────────────────────────────────────────


def list_agents_for_skill(skill_id: str) -> list[str]:
    """Return agent_ids that have this skill."""
    conn = _ensure_conn()
    rows = conn.execute(
        "SELECT agent_id FROM agent_skills WHERE skill_id=? ORDER BY agent_id", (skill_id.strip(),)
    ).fetchall()
    return [r["agent_id"] for r in rows]


# ── File deployment ──────────────────────────────────────────────────────


def _version_installed(dest: Path) -> str:
    """Read the version from an installed skill's SKILL.md frontmatter.

    Returns ``""`` when the file is missing or unparseable.
    """
    import yaml

    skill_md = dest / "SKILL.md"
    if not skill_md.is_file():
        return ""
    try:
        content = skill_md.read_text(encoding="utf-8")
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                fm = yaml.safe_load(parts[1]) or {}
                return str(fm.get("version", "")).strip()
    except Exception:
        pass
    return ""


def deploy_skill_to_agent_workspace(
    skill_id: str,
    agent_id: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Copy skill files to agent's .skills/ directory.

    Skips re-deployment when the installed version already matches the
    market version (unless *force* is True).
    """
    import shutil
    import zipfile

    from infra import agents as agents_store, skill_market

    agent = agents_store.get_agent(agent_id)
    if agent is None:
        return {"deployed": False, "skipped": False, "version": "", "reason": "agent not found"}

    root = agents_store.resolve_agent_path(agent)
    dest = root / ".evotown" / "skills" / skill_id

    skill = skill_market.get_skill(skill_id)
    market_version = (skill.get("version") or "").strip() if skill else ""
    if not market_version:
        return {"deployed": False, "skipped": False, "version": "", "reason": "skill not found in market"}

    installed_version = _version_installed(dest)

    # Already latest → skip
    if installed_version and installed_version == market_version and not force:
        return {
            "deployed": False,
            "skipped": True,
            "version": installed_version,
            "reason": f"already at latest ({market_version})",
        }

    # Remove old and copy new
    if dest.exists():
        shutil.rmtree(dest)

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


# ── Batch assignment ─────────────────────────────────────────────────────


def add_skills(agent_id: str, skill_ids: list[str]) -> None:
    """Append skills to an agent's existing assignments."""
    conn = _ensure_conn()
    for sid in skill_ids:
        sid = sid.strip()
        if sid:
            conn.execute(
                "INSERT OR IGNORE INTO agent_skills (agent_id, skill_id) VALUES (?, ?)",
                (agent_id, sid),
            )


def set_agent_skills(
    agent_id: str,
    skill_ids: list[str],
    *,
    force: bool = False,
    mode: str = "replace",
) -> dict[str, Any]:
    """Assign skills to an agent (DB binding + file deployment).

    *Resolves transitive dependencies*: if skill B requires skill A,
    deploying B also deploys A.  Direct assignments are stored in the DB;
    dependencies are resolved at deploy time and read time.

    mode: ``"replace"`` (default) replaces all existing skills;
    ``"append"`` adds without removing.
    """
    # 1. DB assignment — store only direct skills
    if mode == "append":
        add_skills(agent_id, skill_ids)
    else:
        assign(agent_id, skill_ids)

    # 2. Resolve full dependency set
    all_ids = _resolve_dependencies(skill_ids)

    # 3. Deploy files — all skills (direct + deps), skip already-installed
    results: list[dict[str, Any]] = []
    for sid in all_ids:
        r = deploy_skill_to_agent_workspace(sid, agent_id, force=force)
        results.append({"skill_id": sid, **r})

    return {
        "agent_id": agent_id,
        "skills": list_for_agent(agent_id),
        "resolved_skills": all_ids,
        "deploy_results": results,
    }


# ── Deployment status ────────────────────────────────────────────────────


def get_skill_deploy_status(skill_id: str) -> list[dict[str, Any]]:
    """Return deployment status of a skill across all agents.

    Each entry: {agent_id, agent_name, category, deployed: bool, version: str|null, is_latest: bool}
    """
    from infra import agents as agents_store, skill_market

    skill = skill_market.get_skill(skill_id)
    market_version = (skill.get("version") or "").strip() if skill else ""

    all_agents = agents_store.list_agents(limit=500)
    deployed_agent_ids = set(list_agents_for_skill(skill_id))

    result = []
    for agent in all_agents:
        agent_id = agent["agent_id"]
        deployed = agent_id in deployed_agent_ids
        installed_version = ""
        is_latest = False

        if deployed:
            root = agents_store.resolve_agent_path(agent)
            installed_version = _version_installed(root / ".evotown" / "skills" / skill_id)
            is_latest = bool(market_version and installed_version == market_version)

        result.append({
            "agent_id": agent_id,
            "agent_name": agent.get("name", agent.get("display_name", agent_id)),
            "category": agent.get("category", "employee"),
            "deployed": deployed,
            "version": installed_version,
            "is_latest": is_latest,
        })

    return result


def undeploy_skill_from_agent(agent_id: str, skill_id: str) -> dict[str, Any]:
    """Remove skill binding and delete files from agent workspace."""
    import shutil
    from infra import agents as agents_store

    revoke(agent_id, skill_id)

    agent = agents_store.get_agent(agent_id)
    if agent:
        root = agents_store.resolve_agent_path(agent)
        dest = root / ".evotown" / "skills" / skill_id
        if dest.exists():
            shutil.rmtree(dest)

    return {"agent_id": agent_id, "skill_id": skill_id, "undeployed": True}
