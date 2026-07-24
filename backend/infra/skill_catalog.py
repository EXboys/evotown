"""Evotown curated starter catalog and open ecosystem skill index."""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from domain.models import SkillCandidateCreate
from infra import skill_market

logger = logging.getLogger("evotown.skill_catalog")

_backend_dir = Path(__file__).resolve().parent.parent
_catalog_dir = _backend_dir / "catalog"
_starter_path = _catalog_dir / "starter-skills.json"
_bundled_ecosystem_path = _catalog_dir / "ecosystem-skills.json"

_DEFAULT_RUNTIME_TARGETS = ["openclaw", "hermes", "skilllite", "custom"]
_ECOSYSTEM_ENGINE_ID = "evotown-catalog"
_ECOSYSTEM_SOURCE_RUN = "ecosystem-import"


def _data_dir() -> Path:
    default = _backend_dir.parent / "data"
    if not default.is_dir():
        default = _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


def _ecosystem_cache_path() -> Path:
    return _data_dir() / "ecosystem_skills_cache.json"


def _load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"version": 1, "skills": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_starter_catalog() -> dict[str, Any]:
    return _load_json(_starter_path)


def list_starter_entries() -> list[dict[str, Any]]:
    catalog = load_starter_catalog()
    skills = catalog.get("skills", [])
    if not isinstance(skills, list):
        return []
    result: list[dict[str, Any]] = []
    for entry in skills:
        if not isinstance(entry, dict):
            continue
        skill_id = str(entry.get("skill_id") or entry.get("catalog_id") or "")
        existing = skill_market.get_skill(skill_id) if skill_id else None
        item = dict(entry)
        item["imported"] = existing is not None and existing.get("status") != "deprecated"
        if existing:
            item["enterprise_status"] = existing.get("status")
        result.append(item)
    return result


def starter_entry(catalog_id: str) -> dict[str, Any] | None:
    for entry in list_starter_entries():
        if entry.get("catalog_id") == catalog_id or entry.get("skill_id") == catalog_id:
            return entry
    return None


def import_starter_skill(catalog_id: str, *, auto_approve: bool = True) -> dict[str, Any]:
    entry = starter_entry(catalog_id)
    if entry is None:
        raise ValueError(f"starter skill not found: {catalog_id}")
    source = entry.get("source") or {}
    if source.get("type") != "builtin":
        raise ValueError("only builtin starter skills can be imported directly")
    skill_id = str(entry.get("skill_id") or catalog_id)
    if skill_market._builtin_skill_source(skill_id) is None:  # noqa: SLF001
        raise ValueError(f"builtin skill source missing: {skill_id}")

    runtime_targets = entry.get("runtime_targets") or _DEFAULT_RUNTIME_TARGETS
    tags = list(entry.get("tags") or [])
    if "evotown-starter" not in tags:
        tags.append("evotown-starter")

    package_url = f"builtin://skills/{skill_id}"
    conn = skill_market._ensure_conn()  # noqa: SLF001
    status = "approved" if auto_approve else "pending"
    conn.execute(
        """
        INSERT INTO skills (
            skill_id, name, description, version, runtime_targets, package_url,
            status, visibility, team_id, tags, source_type, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'company', '', ?, 'market', datetime('now'))
        ON CONFLICT(skill_id) DO UPDATE SET
            name=excluded.name,
            description=excluded.description,
            version=excluded.version,
            runtime_targets=excluded.runtime_targets,
            package_url=excluded.package_url,
            status=excluded.status,
            tags=excluded.tags,
            source_type='market',
            updated_at=datetime('now')
        """,
        (
            skill_id,
            entry.get("name", skill_id),
            entry.get("description", ""),
            entry.get("version", "0.1.0"),
            skill_market._json_dumps(runtime_targets),  # noqa: SLF001
            package_url,
            status,
            skill_market._json_dumps(tags),  # noqa: SLF001
        ),
    )
    skill = skill_market.get_skill(skill_id)
    if skill is None:
        raise RuntimeError(f"failed to import starter skill: {skill_id}")
    return skill


def import_all_starters(*, auto_approve: bool = True) -> list[dict[str, Any]]:
    imported: list[dict[str, Any]] = []
    for entry in load_starter_catalog().get("skills", []):
        if not isinstance(entry, dict):
            continue
        catalog_id = str(entry.get("catalog_id") or entry.get("skill_id") or "")
        if not catalog_id:
            continue
        try:
            imported.append(import_starter_skill(catalog_id, auto_approve=auto_approve))
        except ValueError as exc:
            logger.warning("skip starter import %s: %s", catalog_id, exc)
    return imported


def _normalize_ecosystem_payload(payload: dict[str, Any], *, source_label: str) -> dict[str, Any]:
    skills = payload.get("skills", [])
    if not isinstance(skills, list):
        skills = []
    normalized: list[dict[str, Any]] = []
    for item in skills:
        if not isinstance(item, dict):
            continue
        catalog_id = str(item.get("catalog_id") or item.get("name") or "")
        if not catalog_id:
            continue
        normalized.append(dict(item))
    fetched_at = payload.get("fetched_at") or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return {
        "version": payload.get("version", 1),
        "source": source_label,
        "fetched_at": fetched_at,
        "skills": normalized,
    }


def load_ecosystem_catalog() -> dict[str, Any]:
    cache_path = _ecosystem_cache_path()
    if cache_path.is_file():
        return _load_json(cache_path)
    return _load_json(_bundled_ecosystem_path)


def list_ecosystem_entries(
    *,
    query: str | None = None,
    tag: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    catalog = load_ecosystem_catalog()
    skills = catalog.get("skills", [])
    if not isinstance(skills, list):
        return []
    result: list[dict[str, Any]] = []
    q = (query or "").strip().lower()
    for entry in skills:
        if not isinstance(entry, dict):
            continue
        if tag and tag not in (entry.get("tags") or []):
            continue
        if q:
            hay = " ".join(
                [
                    str(entry.get("name") or ""),
                    str(entry.get("description") or ""),
                    str(entry.get("install_ref") or ""),
                    " ".join(entry.get("tags") or []),
                ]
            ).lower()
            if q not in hay:
                continue
        catalog_id = str(entry.get("catalog_id") or "")
        candidate_id = _ecosystem_candidate_id(catalog_id)
        candidate = skill_market.get_candidate(candidate_id) if catalog_id else None
        skill_id = _ecosystem_skill_id(entry)
        existing_skill = skill_market.get_skill(skill_id)
        item = dict(entry)
        item["candidate_id"] = candidate_id
        item["pending_review"] = candidate is not None and candidate.get("status") == "pending"
        item["imported"] = existing_skill is not None and existing_skill.get("status") != "deprecated"
        result.append(item)
        if len(result) >= max(1, min(limit, 500)):
            break
    return result


def ecosystem_entry(catalog_id: str) -> dict[str, Any] | None:
    for entry in load_ecosystem_catalog().get("skills", []):
        if isinstance(entry, dict) and entry.get("catalog_id") == catalog_id:
            return dict(entry)
    return None


def _ecosystem_candidate_id(catalog_id: str) -> str:
    safe = catalog_id.replace("/", "-").replace("@", "-")
    return f"eco_{safe}"[:128]


def _ecosystem_skill_id(entry: dict[str, Any]) -> str:
    source = entry.get("source") or {}
    skill = str(source.get("skill") or entry.get("catalog_id") or "")
    owner = str(source.get("owner") or "")
    if owner and skill:
        return f"{owner}-{skill}"[:128]
    return skill[:128]


def sync_ecosystem_catalog(*, force_remote: bool = False) -> dict[str, Any]:
    """Refresh ecosystem cache from optional remote index URL, else bundled catalog."""
    remote_url = os.environ.get("EVOTOWN_SKILLS_ECOSYSTEM_INDEX_URL", "").strip()
    source_label = "bundled"
    payload: dict[str, Any] | None = None

    if remote_url or force_remote:
        url = remote_url or ""
        if url:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Evotown/1.0"})
                with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310
                    raw = resp.read().decode("utf-8")
                payload = json.loads(raw)
                source_label = "remote"
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
                logger.warning("ecosystem remote sync failed (%s): %s", url, exc)

    if payload is None:
        payload = _load_json(_bundled_ecosystem_path)
        source_label = "bundled"

    normalized = _normalize_ecosystem_payload(payload, source_label=source_label)
    _save_json(_ecosystem_cache_path(), normalized)
    return {
        "synced": True,
        "source": source_label,
        "fetched_at": normalized.get("fetched_at"),
        "count": len(normalized.get("skills", [])),
    }


def import_ecosystem_skill(catalog_id: str, *, runtime_target: str = "skilllite") -> dict[str, Any]:
    entry = ecosystem_entry(catalog_id)
    if entry is None:
        raise ValueError(f"ecosystem skill not found: {catalog_id}")

    candidate_id = _ecosystem_candidate_id(catalog_id)
    existing = skill_market.get_candidate(candidate_id)
    if existing is not None:
        if existing.get("status") == "pending":
            return existing
        raise ValueError(f"ecosystem skill already imported: {catalog_id}")

    skill_id = _ecosystem_skill_id(entry)
    source = entry.get("source") or {}
    inline_manifest = {
        "skill_id": skill_id,
        "catalog_id": catalog_id,
        "install_ref": entry.get("install_ref"),
        "skills_sh_url": entry.get("skills_sh_url"),
        "source_owner": source.get("owner"),
        "source_repo": source.get("repo"),
        "source_skill": source.get("skill"),
        "risk_level": entry.get("risk_level"),
        "import_origin": "ecosystem",
    }
    body = SkillCandidateCreate(
        candidate_id=candidate_id,
        source_run_id=_ECOSYSTEM_SOURCE_RUN,
        tenant_id="",
        team_id="",
        agent_id="",
        engine_id=_ECOSYSTEM_ENGINE_ID,
        runtime_target=runtime_target,  # type: ignore[arg-type]
        name=str(entry.get("name") or catalog_id),
        description=str(entry.get("description") or ""),
        package_url=str(entry.get("skills_sh_url") or ""),
        inline_manifest=inline_manifest,
        signals={"ecosystem_import": True, "install_count": entry.get("install_count", 0)},
    )
    candidate, created = skill_market.create_candidate(body)
    if not created and candidate.get("status") != "pending":
        raise ValueError(f"ecosystem skill already processed: {catalog_id}")
    return candidate


def seed_starter_skills_from_catalog(conn) -> None:
    """Ensure all builtin starters exist in skills table (INSERT OR IGNORE semantics via upsert)."""
    for entry in load_starter_catalog().get("skills", []):
        if not isinstance(entry, dict):
            continue
        source = entry.get("source") or {}
        if source.get("type") != "builtin":
            continue
        skill_id = str(entry.get("skill_id") or entry.get("catalog_id") or "")
        if not skill_id:
            continue
        runtime_targets = entry.get("runtime_targets") or _DEFAULT_RUNTIME_TARGETS
        tags = list(entry.get("tags") or [])
        conn.execute(
            """
            INSERT INTO skills (
                skill_id, name, description, version, runtime_targets, package_url,
                status, visibility, team_id, tags, source_type
            )
            VALUES (?, ?, ?, ?, ?, ?, 'approved', 'company', '', ?, 'market')
            ON CONFLICT(skill_id) DO NOTHING
            """,
            (
                skill_id,
                entry.get("name", skill_id),
                entry.get("description", ""),
                entry.get("version", "0.1.0"),
                skill_market._json_dumps(runtime_targets),  # noqa: SLF001
                f"builtin://skills/{skill_id}",
                skill_market._json_dumps(tags),  # noqa: SLF001
            ),
        )


def ensure_default_bundle_includes_starters(conn) -> None:
    """Add missing starter skills to default-agent-skills bundle if it exists."""
    row = conn.execute(
        "SELECT skills FROM skill_bundles WHERE bundle_id='default-agent-skills' AND channel='stable'"
    ).fetchone()
    if row is None:
        return
    current = skill_market._json_loads(row["skills"], [])  # noqa: SLF001
    if not isinstance(current, list):
        current = []
    existing_ids = {str(item.get("skill_id")) for item in current if isinstance(item, dict)}
    manifest_skills = list(current)
    changed = False
    for entry in load_starter_catalog().get("skills", []):
        if not isinstance(entry, dict):
            continue
        skill_id = str(entry.get("skill_id") or "")
        if not skill_id or skill_id in existing_ids:
            continue
        manifest_skills.append(
            {
                "skill_id": skill_id,
                "name": entry.get("name", skill_id),
                "version": entry.get("version", "0.1.0"),
                "package_url": f"builtin://skills/{skill_id}",
            }
        )
        changed = True
    if changed:
        conn.execute(
            """
            UPDATE skill_bundles
            SET skills=?, published_at=datetime('now')
            WHERE bundle_id='default-agent-skills' AND channel='stable'
            """,
            (skill_market._json_dumps(manifest_skills),),  # noqa: SLF001
        )
