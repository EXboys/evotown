"""Private Skills Market persistence.

This is the first in-repo implementation slice for enterprise bootstrap
bundles and connector-submitted candidate skills. It intentionally keeps the
package payload opaque so OpenClaw, Hermes, SkillLite, and custom runtimes can
resolve packages through their own installers.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from domain.models import SkillCandidateCreate, SkillCandidateReview

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
    conn = sqlite3.connect(str(data_dir / "skills_market.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS skills (
            skill_id        TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            version         TEXT NOT NULL DEFAULT '0.1.0',
            runtime_targets TEXT NOT NULL DEFAULT '[]',
            package_url     TEXT NOT NULL DEFAULT '',
            status          TEXT NOT NULL DEFAULT 'approved',
            visibility      TEXT NOT NULL DEFAULT 'company',
            team_id         TEXT NOT NULL DEFAULT '',
            tags            TEXT NOT NULL DEFAULT '[]',
            source_run_id   TEXT NOT NULL DEFAULT '',
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);
        CREATE INDEX IF NOT EXISTS idx_skills_team ON skills(team_id);

        CREATE TABLE IF NOT EXISTS skill_bundles (
            bundle_id       TEXT NOT NULL,
            version         TEXT NOT NULL,
            channel         TEXT NOT NULL DEFAULT 'stable',
            runtime_targets TEXT NOT NULL DEFAULT '[]',
            skills          TEXT NOT NULL DEFAULT '[]',
            signature       TEXT NOT NULL DEFAULT '',
            published_at    TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (bundle_id, channel)
        );

        CREATE TABLE IF NOT EXISTS skill_candidates (
            candidate_id      TEXT PRIMARY KEY,
            source_run_id     TEXT NOT NULL,
            tenant_id         TEXT NOT NULL DEFAULT '',
            team_id           TEXT NOT NULL DEFAULT '',
            agent_id          TEXT NOT NULL DEFAULT '',
            engine_id         TEXT NOT NULL,
            runtime_target    TEXT NOT NULL,
            name              TEXT NOT NULL,
            description       TEXT NOT NULL DEFAULT '',
            package_url       TEXT,
            inline_manifest   TEXT NOT NULL DEFAULT '{}',
            signals           TEXT NOT NULL DEFAULT '{}',
            status            TEXT NOT NULL DEFAULT 'pending',
            reviewer          TEXT NOT NULL DEFAULT '',
            review_reason     TEXT NOT NULL DEFAULT '',
            visibility        TEXT NOT NULL DEFAULT 'team',
            promotion_channel TEXT,
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            reviewed_at       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_skill_candidates_status ON skill_candidates(status);
        CREATE INDEX IF NOT EXISTS idx_skill_candidates_engine ON skill_candidates(engine_id);
        CREATE INDEX IF NOT EXISTS idx_skill_candidates_team ON skill_candidates(team_id);
        """
    )
    _seed_defaults(conn)
    _conn = conn
    return conn


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _seed_defaults(conn: sqlite3.Connection) -> None:
    existing = conn.execute("SELECT 1 FROM skill_bundles WHERE bundle_id='default-agent-skills' AND channel='stable'").fetchone()
    if existing:
        return
    targets = ["openclaw", "hermes", "skilllite", "custom"]
    seed_skills = [
        {
            "skill_id": "http-request",
            "name": "HTTP Request",
            "description": "Make simple HTTP requests from agent workflows.",
            "version": "0.1.0",
            "package_url": "builtin://skills/http-request",
            "tags": ["network", "integration"],
        },
        {
            "skill_id": "calculator",
            "name": "Calculator",
            "description": "Perform deterministic arithmetic operations.",
            "version": "0.1.0",
            "package_url": "builtin://skills/calculator",
            "tags": ["utility"],
        },
        {
            "skill_id": "find-skills",
            "name": "Find Skills",
            "description": "Discover available skills from the configured market.",
            "version": "0.1.0",
            "package_url": "builtin://skills/find-skills",
            "tags": ["market", "bootstrap"],
        },
    ]
    for skill in seed_skills:
        conn.execute(
            """
            INSERT OR IGNORE INTO skills (
                skill_id, name, description, version, runtime_targets, package_url, tags
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                skill["skill_id"],
                skill["name"],
                skill["description"],
                skill["version"],
                _json_dumps(targets),
                skill["package_url"],
                _json_dumps(skill["tags"]),
            ),
        )
    manifest_skills = [
        {
            "skill_id": skill["skill_id"],
            "name": skill["name"],
            "version": skill["version"],
            "package_url": skill["package_url"],
        }
        for skill in seed_skills
    ]
    conn.execute(
        """
        INSERT INTO skill_bundles (bundle_id, version, channel, runtime_targets, skills, signature)
        VALUES ('default-agent-skills', '0.1.0', 'stable', ?, ?, 'dev-seed')
        """,
        (_json_dumps(targets), _json_dumps(manifest_skills)),
    )


def _skill_from_row(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["runtime_targets"] = _json_loads(item.get("runtime_targets", "[]"), [])
    item["tags"] = _json_loads(item.get("tags", "[]"), [])
    return item


def _candidate_from_row(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["inline_manifest"] = _json_loads(item.get("inline_manifest", "{}"), {})
    item["signals"] = _json_loads(item.get("signals", "{}"), {})
    return item


def get_bundle_manifest(
    bundle_id: str,
    *,
    channel: str = "stable",
    runtime_target: str | None = None,
) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM skill_bundles WHERE bundle_id=? AND channel=?",
        (bundle_id, channel),
    ).fetchone()
    if row is None:
        return None
    item = dict(row)
    runtime_targets = _json_loads(item.get("runtime_targets", "[]"), [])
    if runtime_target and runtime_target not in runtime_targets:
        return None
    return {
        "bundle_id": item["bundle_id"],
        "version": item["version"],
        "channel": item["channel"],
        "runtime_targets": runtime_targets,
        "skills": _json_loads(item.get("skills", "[]"), []),
        "signature": item.get("signature", ""),
        "published_at": item["published_at"],
    }


def list_skills(
    *,
    team_id: str | None = None,
    runtime_target: str | None = None,
    tag: str | None = None,
    status: str | None = None,
    query: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if team_id:
        clauses.append("(team_id='' OR team_id=?)")
        params.append(team_id)
    if status:
        clauses.append("status=?")
        params.append(status)
    if query:
        clauses.append("(lower(name) LIKE ? OR lower(description) LIKE ?)")
        q = f"%{query.lower()}%"
        params.extend([q, q])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 500)))
    rows = _ensure_conn().execute(
        f"SELECT * FROM skills {where} ORDER BY updated_at DESC LIMIT ?",
        params,
    ).fetchall()
    result = [_skill_from_row(row) for row in rows]
    if runtime_target:
        result = [item for item in result if runtime_target in item["runtime_targets"]]
    if tag:
        result = [item for item in result if tag in item["tags"]]
    return result


def create_candidate(body: SkillCandidateCreate) -> tuple[dict[str, Any], bool]:
    conn = _ensure_conn()
    existing = get_candidate(body.candidate_id)
    if existing is not None:
        return existing, False
    conn.execute(
        """
        INSERT INTO skill_candidates (
            candidate_id, source_run_id, tenant_id, team_id, agent_id, engine_id,
            runtime_target, name, description, package_url, inline_manifest, signals
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            body.candidate_id,
            body.source_run_id,
            body.tenant_id,
            body.team_id,
            body.agent_id,
            body.engine_id,
            body.runtime_target,
            body.name,
            body.description,
            body.package_url,
            _json_dumps(body.inline_manifest),
            _json_dumps(body.signals),
        ),
    )
    return get_candidate(body.candidate_id) or {"candidate_id": body.candidate_id}, True


def get_candidate(candidate_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM skill_candidates WHERE candidate_id=?",
        (candidate_id,),
    ).fetchone()
    return _candidate_from_row(row) if row else None


def list_candidates(
    *,
    status: str | None = None,
    team_id: str | None = None,
    engine_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status=?")
        params.append(status)
    if team_id:
        clauses.append("team_id=?")
        params.append(team_id)
    if engine_id:
        clauses.append("engine_id=?")
        params.append(engine_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 500)))
    rows = _ensure_conn().execute(
        f"SELECT * FROM skill_candidates {where} ORDER BY created_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_candidate_from_row(row) for row in rows]


def review_candidate(candidate_id: str, body: SkillCandidateReview) -> dict[str, Any] | None:
    candidate = get_candidate(candidate_id)
    if candidate is None:
        return None
    conn = _ensure_conn()
    status = "approved" if body.decision == "approved" else "rejected"
    conn.execute(
        """
        UPDATE skill_candidates
        SET status=?, reviewer=?, review_reason=?, visibility=?,
            promotion_channel=?, reviewed_at=datetime('now')
        WHERE candidate_id=?
        """,
        (
            status,
            body.reviewer,
            body.reason,
            body.visibility,
            body.promotion_channel,
            candidate_id,
        ),
    )
    reviewed = get_candidate(candidate_id)
    if status == "approved" and reviewed is not None:
        _promote_candidate(conn, reviewed)
        reviewed = get_candidate(candidate_id)
    return reviewed


def _promote_candidate(conn: sqlite3.Connection, candidate: dict[str, Any]) -> None:
    skill_id = f"skill_{candidate['candidate_id']}"
    runtime_targets = [candidate["runtime_target"]]
    package_url = candidate.get("package_url") or candidate.get("inline_manifest", {}).get("package_url", "")
    conn.execute(
        """
        INSERT INTO skills (
            skill_id, name, description, version, runtime_targets, package_url,
            status, visibility, team_id, tags, source_run_id, updated_at
        )
        VALUES (?, ?, ?, '0.1.0', ?, ?, 'approved', ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(skill_id) DO UPDATE SET
            name=excluded.name,
            description=excluded.description,
            runtime_targets=excluded.runtime_targets,
            package_url=excluded.package_url,
            visibility=excluded.visibility,
            team_id=excluded.team_id,
            source_run_id=excluded.source_run_id,
            updated_at=datetime('now')
        """,
        (
            skill_id,
            candidate["name"],
            candidate.get("description", ""),
            _json_dumps(runtime_targets),
            package_url,
            candidate.get("visibility", "team"),
            candidate.get("team_id", ""),
            _json_dumps(["candidate", candidate["runtime_target"]]),
            candidate.get("source_run_id", ""),
        ),
    )

