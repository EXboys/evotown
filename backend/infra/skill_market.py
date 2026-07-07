"""Private Skills Market persistence.

This is the first in-repo implementation slice for enterprise bootstrap
bundles and connector-submitted candidate skills. It intentionally keeps the
package payload opaque so OpenClaw, Hermes, SkillLite, and custom runtimes can
resolve packages through their own installers.
"""
from __future__ import annotations

import json
import os
import base64
import hashlib
import sqlite3
import zipfile
from pathlib import Path
from typing import Any

from domain.models import SkillCandidateCreate, SkillCandidateReview, SkillPackageUpload
from infra import skill_signing

_backend_dir = Path(__file__).resolve().parent.parent
_arena_skills_dir = _backend_dir / "arena_skills"
_custom_skills_dir = _backend_dir / "data" / "custom-skills"
_evotown_data = _backend_dir.parent / "data"


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


_conn: sqlite3.Connection | None = None


def _package_dir() -> Path:
    path = _data_dir() / "skill_packages"
    path.mkdir(parents=True, exist_ok=True)
    return path


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
            package_sha256  TEXT NOT NULL DEFAULT '',
            package_bytes   INTEGER NOT NULL DEFAULT 0,
            status          TEXT NOT NULL DEFAULT 'approved',
            visibility      TEXT NOT NULL DEFAULT 'company',
            team_id         TEXT NOT NULL DEFAULT '',
            tags            TEXT NOT NULL DEFAULT '[]',
            source_run_id   TEXT NOT NULL DEFAULT '',
            source_type     TEXT NOT NULL DEFAULT 'enterprise',
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

        CREATE TABLE IF NOT EXISTS skill_package_files (
            skill_id     TEXT PRIMARY KEY,
            filename     TEXT NOT NULL,
            stored_name  TEXT NOT NULL,
            sha256       TEXT NOT NULL,
            bytes        INTEGER NOT NULL,
            uploaded_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS skill_versions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id            TEXT NOT NULL,
            version             TEXT NOT NULL,
            description         TEXT NOT NULL DEFAULT '',
            readme              TEXT NOT NULL DEFAULT '',
            dependencies        TEXT NOT NULL DEFAULT '[]',
            package_sha256      TEXT NOT NULL DEFAULT '',
            package_bytes       INTEGER NOT NULL DEFAULT 0,
            source_run_id       TEXT NOT NULL DEFAULT '',
            status              TEXT NOT NULL DEFAULT 'pending',
            version_notes       TEXT NOT NULL DEFAULT '',
            submitted_by_agent_id  TEXT NOT NULL DEFAULT '',
            submitted_by_account   TEXT NOT NULL DEFAULT '',
            reviewed_by         TEXT NOT NULL DEFAULT '',
            reviewed_at         TEXT NOT NULL DEFAULT '',
            review_comment      TEXT NOT NULL DEFAULT '',
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(skill_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_versions(skill_id);

        CREATE TABLE IF NOT EXISTS skill_usage_log (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id       TEXT NOT NULL,
            agent_id       TEXT NOT NULL DEFAULT '',
            run_id         TEXT NOT NULL DEFAULT '',
            account        TEXT NOT NULL DEFAULT '',
            event          TEXT NOT NULL DEFAULT '',
            details        TEXT NOT NULL DEFAULT '{}',
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_skill_usage_skill ON skill_usage_log(skill_id);
        CREATE INDEX IF NOT EXISTS idx_skill_usage_time ON skill_usage_log(created_at);
        """
    )
    _migrate_skills_schema(conn)
    _seed_defaults(conn)
    from infra import skill_catalog

    skill_catalog.seed_starter_skills_from_catalog(conn)
    skill_catalog.ensure_default_bundle_includes_starters(conn)
    _conn = conn
    return conn


def _migrate_skills_schema(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(skills)").fetchall()}
    if "package_sha256" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN package_sha256 TEXT NOT NULL DEFAULT ''")
    if "package_bytes" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN package_bytes INTEGER NOT NULL DEFAULT 0")
    if "readme" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN readme TEXT NOT NULL DEFAULT ''")
    if "dependencies" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN dependencies TEXT NOT NULL DEFAULT '[]'")
    if "download_count" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0")
    if "package_signature" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN package_signature TEXT NOT NULL DEFAULT ''")
    if "source_type" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN source_type TEXT NOT NULL DEFAULT 'enterprise'")
    if "category" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN category TEXT NOT NULL DEFAULT ''")
    if "agent_id" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''")
    if "created_by" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN created_by TEXT NOT NULL DEFAULT ''")

    # ── skill_versions migration ──────────────────────────────────
    ver_cols = {row["name"] for row in conn.execute("PRAGMA table_info(skill_versions)").fetchall()}
    if "status" not in ver_cols:
        conn.execute("ALTER TABLE skill_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_skill_versions_status ON skill_versions(status)")
    if "version_notes" not in ver_cols:
        conn.execute("ALTER TABLE skill_versions ADD COLUMN version_notes TEXT NOT NULL DEFAULT ''")
    if "submitted_by_agent_id" not in ver_cols:
        conn.execute("ALTER TABLE skill_versions ADD COLUMN submitted_by_agent_id TEXT NOT NULL DEFAULT ''")
    if "submitted_by_account" not in ver_cols:
        conn.execute("ALTER TABLE skill_versions ADD COLUMN submitted_by_account TEXT NOT NULL DEFAULT ''")
    if "reviewed_by" not in ver_cols:
        conn.execute("ALTER TABLE skill_versions ADD COLUMN reviewed_by TEXT NOT NULL DEFAULT ''")
    if "reviewed_at" not in ver_cols:
        conn.execute("ALTER TABLE skill_versions ADD COLUMN reviewed_at TEXT NOT NULL DEFAULT ''")
    if "review_comment" not in ver_cols:
        conn.execute("ALTER TABLE skill_versions ADD COLUMN review_comment TEXT NOT NULL DEFAULT ''")
    if "requires_skills" not in ver_cols:
        conn.execute("ALTER TABLE skill_versions ADD COLUMN requires_skills TEXT NOT NULL DEFAULT '[]'")


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
    from infra import skill_catalog

    catalog = skill_catalog.load_starter_catalog()
    targets = ["openclaw", "hermes", "skilllite", "custom"]
    manifest_skills = [
        {
            "skill_id": str(entry.get("skill_id") or entry.get("catalog_id") or ""),
            "name": entry.get("name", ""),
            "version": entry.get("version", "0.1.0"),
            "package_url": f"builtin://skills/{entry.get('skill_id')}",
        }
        for entry in catalog.get("skills", [])
        if isinstance(entry, dict) and entry.get("skill_id")
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
    item["dependencies"] = _json_loads(item.get("dependencies", "[]"), [])
    digest = str(item.get("package_sha256") or "")
    if digest and not item.get("package_signature"):
        item["package_signature"] = skill_signing.sign_digest_hex(digest)
    return item


def _manifest_entry_with_signature(entry: dict[str, Any]) -> dict[str, Any]:
    item = dict(entry)
    skill_id = item.get("skill_id", "")
    package_url = item.get("package_url", "")
    if not skill_id or str(package_url).startswith("builtin://"):
        return item
    skill = get_skill(skill_id)
    if skill is None:
        return item
    digest = str(skill.get("package_sha256") or "")
    if digest:
        item["package_sha256"] = digest
        item["signature"] = skill.get("package_signature") or skill_signing.sign_digest_hex(digest)
    return item


def _version_from_row(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["dependencies"] = _json_loads(item.get("dependencies", "[]"), [])
    return item


def _record_skill_version(
    conn: sqlite3.Connection,
    *,
    skill_id: str,
    version: str,
    description: str,
    readme: str,
    dependencies: list[str],
    package_sha256: str,
    package_bytes: int,
    source_run_id: str,
) -> None:
    conn.execute(
        """
        INSERT INTO skill_versions (
            skill_id, version, description, readme, dependencies,
            package_sha256, package_bytes, source_run_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(skill_id, version) DO UPDATE SET
            description=excluded.description,
            readme=excluded.readme,
            dependencies=excluded.dependencies,
            package_sha256=excluded.package_sha256,
            package_bytes=excluded.package_bytes,
            source_run_id=excluded.source_run_id,
            created_at=datetime('now')
        """,
        (
            skill_id,
            version,
            description,
            readme,
            _json_dumps(dependencies),
            package_sha256,
            package_bytes,
            source_run_id,
        ),
    )


def submit_skill_version(
    *,
    skill_id: str,
    version: str,
    description: str = "",
    version_notes: str = "",
    requires_skills: str = "[]",
    submitted_by_agent_id: str = "",
    submitted_by_account: str = "",
) -> dict[str, Any]:
    """Submit a new skill version for review (status=pending)."""
    conn = _ensure_conn()
    conn.execute(
        """
        INSERT INTO skill_versions (
            skill_id, version, description, status, version_notes,
            requires_skills, submitted_by_agent_id, submitted_by_account
        )
        VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
        """,
        (
            skill_id,
            version,
            description,
            version_notes,
            requires_skills,
            submitted_by_agent_id,
            submitted_by_account,
        ),
    )
    return dict(conn.execute(
        "SELECT * FROM skill_versions WHERE skill_id=? AND version=?",
        (skill_id, version),
    ).fetchone() or {})


def get_latest_skill_version(skill_id: str) -> dict[str, Any] | None:
    """Get the latest version record for a skill."""
    row = _ensure_conn().execute(
        "SELECT * FROM skill_versions WHERE skill_id=? ORDER BY created_at DESC LIMIT 1",
        (skill_id,),
    ).fetchone()
    return dict(row) if row else None


def list_skill_versions(skill_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        """
        SELECT * FROM skill_versions
        WHERE skill_id=?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (skill_id, max(1, min(limit, 100))),
    ).fetchall()
    return [_version_from_row(row) for row in rows]


def record_download(skill_id: str) -> None:
    _ensure_conn().execute(
        "UPDATE skills SET download_count = download_count + 1, updated_at=updated_at WHERE skill_id=?",
        (skill_id,),
    )


def list_market_skills(
    *,
    team_id: str | None = None,
    runtime_target: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    return list_skills(
        team_id=team_id,
        runtime_target=runtime_target,
        tag=tag,
        status="approved",
        query=query,
        limit=limit,
    )


def get_market_skill(skill_id: str) -> dict[str, Any] | None:
    skill = get_skill(skill_id)
    if skill is None or skill.get("status") != "approved":
        return None
    skill["versions"] = list_skill_versions(skill_id)
    return skill


def _safe_filename(filename: str) -> str:
    name = Path(filename).name.strip().replace(" ", "_")
    return name or "package.zip"


def _safe_skill_id(skill_id: str) -> str:
    return "".join(c if c.isalnum() or c in {"-", "_", "."} else "_" for c in skill_id)


def _candidate_from_row(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["inline_manifest"] = _json_loads(item.get("inline_manifest", "{}"), {})
    item["signals"] = _json_loads(item.get("signals", "{}"), {})
    return item


def list_bundles() -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        "SELECT * FROM skill_bundles ORDER BY bundle_id ASC, channel ASC",
    ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["runtime_targets"] = _json_loads(item.get("runtime_targets", "[]"), [])
        item["skills"] = _json_loads(item.get("skills", "[]"), [])
        result.append(item)
    return result


def _skill_to_manifest_entry(skill: dict[str, Any]) -> dict[str, Any]:
    return {
        "skill_id": skill["skill_id"],
        "name": skill["name"],
        "version": skill.get("version", "0.1.0"),
        "package_url": skill.get("package_url", ""),
    }


def _next_bundle_version(current: str | None) -> str:
    if not current:
        return "1.0.0"
    parts = current.strip().split(".")
    if len(parts) == 3 and all(part.isdigit() for part in parts):
        major, minor, patch = (int(parts[0]), int(parts[1]), int(parts[2]))
        return f"{major}.{minor}.{patch + 1}"
    return current


def _resolve_publish_skill_ids(
    *,
    skill_ids: list[str],
    include_all_approved: bool,
    team_id: str | None,
    runtime_target: str | None,
) -> list[str]:
    if skill_ids:
        return skill_ids
    if include_all_approved:
        skills = list_skills(
            status="approved",
            team_id=team_id or None,
            runtime_target=runtime_target,
            limit=500,
        )
        return [item["skill_id"] for item in skills]
    raise ValueError("skill_ids required unless include_all_approved is true")


def publish_bundle(
    bundle_id: str,
    *,
    channel: str = "stable",
    version: str | None = None,
    runtime_targets: list[str] | None = None,
    skill_ids: list[str] | None = None,
    include_all_approved: bool = False,
    team_id: str | None = None,
    runtime_target: str | None = None,
) -> dict[str, Any]:
    conn = _ensure_conn()
    existing = conn.execute(
        "SELECT version, runtime_targets FROM skill_bundles WHERE bundle_id=? AND channel=?",
        (bundle_id, channel),
    ).fetchone()
    resolved_ids = list(
        dict.fromkeys(
            _resolve_publish_skill_ids(
                skill_ids=list(skill_ids or []),
                include_all_approved=include_all_approved,
                team_id=team_id,
                runtime_target=runtime_target,
            )
        )
    )
    if not resolved_ids:
        raise ValueError("no approved skills to publish")

    manifest_skills: list[dict[str, Any]] = []
    union_targets: set[str] = set(runtime_targets or [])
    for skill_id in resolved_ids:
        skill = get_skill(skill_id)
        if skill is None:
            raise ValueError(f"skill not found: {skill_id}")
        if skill.get("status") != "approved":
            raise ValueError(f"skill is not approved: {skill_id}")
        manifest_skills.append(_skill_to_manifest_entry(skill))
        union_targets.update(skill.get("runtime_targets") or [])

    if not union_targets:
        union_targets = set(runtime_targets or ["openclaw", "hermes", "skilllite", "custom"])

    publish_version = version or _next_bundle_version(existing["version"] if existing else None)
    targets_json = _json_dumps(sorted(union_targets))
    skills_json = _json_dumps(manifest_skills)
    digest = hashlib.sha256(skills_json.encode("utf-8")).hexdigest()
    bundle_signature = skill_signing.sign_digest_hex(digest) or "unsigned"

    conn.execute(
        """
        INSERT INTO skill_bundles (bundle_id, version, channel, runtime_targets, skills, signature, published_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(bundle_id, channel) DO UPDATE SET
            version=excluded.version,
            runtime_targets=excluded.runtime_targets,
            skills=excluded.skills,
            signature=excluded.signature,
            published_at=datetime('now')
        """,
        (bundle_id, publish_version, channel, targets_json, skills_json, bundle_signature),
    )
    manifest = get_bundle_manifest(bundle_id, channel=channel)
    if manifest is None:
        raise RuntimeError("bundle publish succeeded but manifest read failed")
    return manifest


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
    manifest_skills = _json_loads(item.get("skills", "[]"), [])
    approved_skills = [
        _manifest_entry_with_signature(dict(entry))
        for entry in manifest_skills
        if _manifest_skill_is_installable(entry.get("skill_id", ""))
    ]
    return {
        "bundle_id": item["bundle_id"],
        "version": item["version"],
        "channel": item["channel"],
        "runtime_targets": runtime_targets,
        "skills": approved_skills,
        "signature": item.get("signature", ""),
        "published_at": item["published_at"],
    }


def _manifest_skill_is_installable(skill_id: str) -> bool:
    if not skill_id:
        return False
    skill = get_skill(skill_id)
    if skill is None:
        return True
    return skill.get("status") == "approved"


def list_skills(
    *,
    team_id: str | None = None,
    runtime_target: str | None = None,
    tag: str | None = None,
    status: str | None = None,
    query: str | None = None,
    source_type: str | None = None,
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
    if source_type:
        clauses.append("source_type=?")
        params.append(source_type)
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


def upload_skill_package(body: SkillPackageUpload) -> dict[str, Any]:
    raw = base64.b64decode(body.content_base64, validate=True)
    digest = hashlib.sha256(raw).hexdigest()
    signature = skill_signing.sign_digest_hex(digest)
    safe_id = _safe_skill_id(body.skill_id)
    safe_name = _safe_filename(body.filename)
    relative_name = f"{safe_id}-{digest[:12]}-{safe_name}"
    package_path = _package_dir() / relative_name
    package_path.write_bytes(raw)
    package_url = f"/api/v1/skill-packages/{body.skill_id}/download"
    conn = _ensure_conn()
    conn.execute(
        """
        INSERT INTO skills (
            skill_id, name, description, version, runtime_targets, package_url,
            package_sha256, package_signature, package_bytes, status, visibility, team_id, tags,
            source_run_id, readme, dependencies, source_type, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, 'external', datetime('now'))
        ON CONFLICT(skill_id) DO UPDATE SET
            name=excluded.name,
            description=excluded.description,
            version=excluded.version,
            runtime_targets=excluded.runtime_targets,
            package_url=excluded.package_url,
            package_sha256=excluded.package_sha256,
            package_signature=excluded.package_signature,
            package_bytes=excluded.package_bytes,
            status='approved',
            visibility=excluded.visibility,
            team_id=excluded.team_id,
            tags=excluded.tags,
            source_run_id=excluded.source_run_id,
            readme=excluded.readme,
            dependencies=excluded.dependencies,
            source_type='external',
            updated_at=datetime('now')
        """,
        (
            body.skill_id,
            body.name,
            body.description,
            body.version,
            _json_dumps(body.runtime_targets),
            package_url,
            digest,
            signature,
            len(raw),
            body.visibility,
            body.team_id,
            _json_dumps(body.tags),
            body.source_run_id,
            body.readme,
            _json_dumps(body.dependencies),
        ),
    )
    _record_skill_version(
        conn,
        skill_id=body.skill_id,
        version=body.version,
        description=body.description,
        readme=body.readme,
        dependencies=body.dependencies,
        package_sha256=digest,
        package_bytes=len(raw),
        source_run_id=body.source_run_id,
    )
    conn.execute(
        """
        INSERT INTO skill_package_files (skill_id, filename, stored_name, sha256, bytes, uploaded_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(skill_id) DO UPDATE SET
            filename=excluded.filename,
            stored_name=excluded.stored_name,
            sha256=excluded.sha256,
            bytes=excluded.bytes,
            uploaded_at=datetime('now')
        """,
        (body.skill_id, safe_name, relative_name, digest, len(raw)),
    )
    return get_skill(body.skill_id) or {"skill_id": body.skill_id}


def verify_package_integrity(skill_id: str) -> bool:
    skill = get_skill(skill_id)
    if skill is None:
        return False
    if _is_builtin_skill(skill):
        return _builtin_skill_source(skill_id) is not None
    package = get_package_file(skill_id)
    if package is None:
        return False
    path, _ = package
    digest = str(skill.get("package_sha256") or "")
    if not digest:
        return True
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != digest:
        return False
    signature = str(skill.get("package_signature") or "")
    if signature:
        return skill_signing.verify_digest_hex(digest, signature)
    if skill_signing.require_signed_downloads():
        return skill_signing.signing_enabled()
    return True


def get_skill(skill_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute("SELECT * FROM skills WHERE skill_id=?", (skill_id,)).fetchone()
    return _skill_from_row(row) if row else None


def deprecate_skill(skill_id: str, *, reason: str = "", reviewer: str = "") -> dict[str, Any] | None:
    del reason, reviewer
    if get_skill(skill_id) is None:
        return None
    conn = _ensure_conn()
    conn.execute(
        """
        UPDATE skills
        SET status='deprecated', updated_at=datetime('now')
        WHERE skill_id=?
        """,
        (skill_id,),
    )
    return get_skill(skill_id)


def get_package_file(skill_id: str) -> tuple[Path, str] | None:
    row = _ensure_conn().execute(
        "SELECT filename, stored_name FROM skill_package_files WHERE skill_id=?",
        (skill_id,),
    ).fetchone()
    if row is None:
        return None
    path = _package_dir() / row["stored_name"]
    if not path.is_file():
        return None
    return path, row["filename"]


def _is_builtin_skill(skill: dict[str, Any]) -> bool:
    return str(skill.get("package_url") or "").startswith("builtin://")


def _builtin_skill_source(skill_id: str) -> Path | None:
    for base in (_arena_skills_dir, _custom_skills_dir):
        src = base / skill_id
        if src.is_dir() and (src / "SKILL.md").is_file():
            return src
    return None


def _newest_mtime(path: Path) -> float:
    latest = 0.0
    for file in path.rglob("*"):
        if file.is_file():
            latest = max(latest, file.stat().st_mtime)
    return latest


def _zip_skill_directory(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(src.rglob("*")):
            if not file.is_file():
                continue
            if "__pycache__" in file.parts:
                continue
            arcname = file.relative_to(src).as_posix()
            zf.write(file, arcname)


def _builtin_package_zip(skill_id: str) -> Path | None:
    src = _builtin_skill_source(skill_id)
    if src is None:
        return None
    cache_dir = _package_dir() / "_builtin_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    zip_path = cache_dir / f"{_safe_skill_id(skill_id)}.zip"
    src_mtime = _newest_mtime(src)
    if zip_path.is_file() and zip_path.stat().st_mtime >= src_mtime:
        return zip_path
    _zip_skill_directory(src, zip_path)
    return zip_path if zip_path.is_file() else None


def resolve_download_package(skill_id: str) -> tuple[Path, str] | None:
    """Uploaded package file, or on-the-fly zip from arena_skills for builtin:// skills."""
    uploaded = get_package_file(skill_id)
    if uploaded is not None:
        return uploaded
    skill = get_skill(skill_id)
    if skill is None:
        return None
    if not _is_builtin_skill(skill) and _builtin_skill_source(skill_id) is None:
        return None
    zip_path = _builtin_package_zip(skill_id)
    if zip_path is None:
        return None
    return zip_path, f"{skill_id}.skill.zip"


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
    inline = candidate.get("inline_manifest") or {}
    if isinstance(inline, str):
        inline = _json_loads(inline, {})
    skill_id = str(inline.get("skill_id") or f"skill_{candidate['candidate_id']}")
    runtime_targets = [candidate["runtime_target"]]
    package_url = candidate.get("package_url") or inline.get("package_url", "")
    conn.execute(
        """
        INSERT INTO skills (
            skill_id, name, description, version, runtime_targets, package_url,
            status, visibility, team_id, tags, source_run_id, source_type, updated_at
        )
        VALUES (?, ?, ?, '0.1.0', ?, ?, 'approved', ?, ?, ?, ?, 'enterprise', datetime('now'))
        ON CONFLICT(skill_id) DO UPDATE SET
            name=excluded.name,
            description=excluded.description,
            runtime_targets=excluded.runtime_targets,
            package_url=excluded.package_url,
            visibility=excluded.visibility,
            team_id=excluded.team_id,
            source_run_id=excluded.source_run_id,
            source_type='enterprise',
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
            _json_dumps(
                ["candidate", candidate["runtime_target"]]
                + (["ecosystem"] if inline.get("import_origin") == "ecosystem" else [])
            ),
            candidate.get("source_run_id", ""),
        ),
    )


# ── Skill management: draft / submit / extract / test ────────────────────────

def create_draft_skill(
    *,
    skill_id: str,
    name: str,
    description: str = "",
    category: str = "",
    runtime_targets: list[str] | None = None,
    team_id: str = "",
    tags: list[str] | None = None,
    source_run_id: str = "",
    source_type: str = "workspace",
    agent_id: str = "",
    created_by: str = "",
) -> dict[str, Any]:
    """Create a skill in draft status for later review."""
    conn = _ensure_conn()
    targets = runtime_targets or ["openclaw", "hermes", "skilllite", "custom"]
    tag_list = tags or []
    package_url = f"builtin://skills/{_safe_skill_id(skill_id)}"
    conn.execute(
        """
        INSERT INTO skills (
            skill_id, name, description, version, runtime_targets, package_url,
            status, visibility, team_id, tags, source_run_id, source_type,
            category, agent_id, created_by
        )
        VALUES (?, ?, ?, '0.1.0', ?, ?, 'draft', 'team', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(skill_id) DO UPDATE SET
            name=excluded.name,
            description=excluded.description,
            runtime_targets=excluded.runtime_targets,
            status='draft',
            visibility='team',
            tags=excluded.tags,
            source_run_id=excluded.source_run_id,
            source_type=excluded.source_type,
            category=excluded.category,
            agent_id=excluded.agent_id,
            created_by=excluded.created_by,
            updated_at=datetime('now')
        """,
        (
            skill_id,
            name,
            description,
            _json_dumps(targets),
            package_url,
            team_id,
            _json_dumps(tag_list),
            source_run_id,
            source_type,
            category,
            agent_id,
            created_by,
        ),
    )
    return get_skill(skill_id) or {"skill_id": skill_id}


def submit_skill_to_review(skill_id: str, *, engine_id: str = "evotown-admin") -> dict[str, Any]:
    """Submit a draft skill for review by creating a candidate record."""
    skill = get_skill(skill_id)
    if skill is None:
        raise ValueError(f"skill not found: {skill_id}")
    if skill.get("status") not in ("draft", "rejected"):
        raise ValueError(f"skill must be in draft or rejected status, got: {skill.get('status')}")

    from domain.models import SkillCandidateCreate

    candidate_id = f"review_{skill_id}"[:128]
    body = SkillCandidateCreate(
        candidate_id=candidate_id,
        source_run_id=str(skill.get("source_run_id") or ""),
        tenant_id="",
        team_id=str(skill.get("team_id") or ""),
        agent_id="",
        engine_id=engine_id,
        runtime_target="skilllite",  # type: ignore[arg-type]
        name=str(skill["name"]),
        description=str(skill.get("description") or ""),
        package_url=str(skill.get("package_url") or ""),
        inline_manifest={"skill_id": skill_id, "name": skill["name"]},
        signals={"submitted_from": "draft"},
    )

    # Update skill status to pending
    conn = _ensure_conn()
    conn.execute(
        "UPDATE skills SET status='pending', updated_at=datetime('now') WHERE skill_id=?",
        (skill_id,),
    )

    candidate, created = create_candidate(body)
    return candidate


# ── Test trigger ─────────────────────────────────────────────────────────────

def trigger_skill_test(
    *,
    skill_id: str,
    test_account_id: str,
    test_prompt: str = "",
    team_id: str = "",
) -> dict[str, Any]:
    """Assign a skill to a test account and trigger a Coding Agent run to test it."""
    from infra import account_skills as acct_skills
    from infra import accounts as accounts_store
    from infra import claude_agent_runs, agents

    skill = get_skill(skill_id)
    if skill is None:
        raise ValueError(f"skill not found: {skill_id}")

    # Ensure test account exists
    account = accounts_store.get_account(test_account_id)
    agent_id: str = ""
    if account is None:
        raise ValueError(f"test account not found: {test_account_id}")

    # Assign the skill to the test account
    current_skills = acct_skills.list_for_account(test_account_id)
    if skill_id not in current_skills:
        acct_skills.assign(test_account_id, [skill_id] + current_skills)

    # Find an agent sandbox for the test account
    agent_list = agents.list_agents(owner_account_id=test_account_id, limit=1)
    if not agent_list:
        raise ValueError(f"no agent found for test account: {test_account_id}")
    agent = agent_list[0]
    agent_id = agent["agent_id"]

    # Build test prompt
    skill_name = skill.get("name", skill_id)
    skill_desc = skill.get("description", "")
    prompt = test_prompt or (
        f"请使用技能 {skill_name} ({skill_id}) 完成以下测试任务：\n"
        f"技能描述：{skill_desc}\n"
        f"请验证该技能是否可以正常加载和运行，并展示运行结果。"
    )

    # Create the agent run
    run_id = claude_agent_runs.create_run(
        agent_id=agent_id,
        prompt=prompt,
        account_id=test_account_id,
        team_id=team_id,
        model="",
    )
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        raise RuntimeError("failed to create test run")

    # Record the test association
    conn = _ensure_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS skill_test_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id    TEXT NOT NULL,
            run_id      TEXT NOT NULL,
            test_prompt TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        "INSERT INTO skill_test_runs (skill_id, run_id, test_prompt) VALUES (?, ?, ?)",
        (skill_id, run_id, prompt),
    )

    return {
        "skill_id": skill_id,
        "run_id": run_id,
        "test_prompt": prompt,
        "agent_id": agent_id,
        "account_id": test_account_id,
    }


def get_skill_test_runs(skill_id: str) -> list[dict[str, Any]]:
    """Get test run history for a skill."""
    conn = _ensure_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS skill_test_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id    TEXT NOT NULL,
            run_id      TEXT NOT NULL,
            test_prompt TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    rows = conn.execute(
        "SELECT * FROM skill_test_runs WHERE skill_id=? ORDER BY created_at DESC LIMIT 50",
        (skill_id,),
    ).fetchall()
    from infra import claude_agent_runs

    results: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        run = claude_agent_runs.get_run(item["run_id"])
        if run:
            item["run_status"] = run.get("status")
            item["run_result"] = str(run.get("result_summary") or run.get("log_excerpt") or "")[:2000]
            item["run_created_at"] = run.get("created_at")
        else:
            item["run_status"] = "unknown"
            item["run_result"] = ""
            item["run_created_at"] = item.get("created_at")
        results.append(item)
    return results


def record_skill_usage(
    *,
    skill_id: str,
    agent_id: str = "",
    run_id: str = "",
    account: str = "",
    event: str = "",
    details: dict[str, Any] | None = None,
) -> None:
    """Record a skill usage event (create / submit / approve / deploy / load / execute)."""
    conn = _ensure_conn()
    conn.execute(
        """
        INSERT INTO skill_usage_log (skill_id, agent_id, run_id, account, event, details)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            skill_id,
            agent_id or "",
            run_id or "",
            account or "",
            event,
            _json_dumps(details or {}),
        ),
    )
