"""Public-facing Skills Market catalog API."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from core.auth import require_console_read, require_console_session
from infra import skill_market

router = APIRouter(prefix="/api/v1/market", tags=["skills-market"])

_ADMIN_PACKAGE_RE = re.compile(r"^/api/v1/skill-packages/(?P<skill_id>[^/]+)/download$")


def _employee_manifest(manifest: dict) -> dict:
    """Rewrite admin-only package URLs to employee market download paths."""
    skills = []
    for entry in manifest.get("skills", []):
        item = dict(entry)
        package_url = str(item.get("package_url", "") or "")
        skill_id = str(item.get("skill_id", "") or "")
        match = _ADMIN_PACKAGE_RE.match(package_url)
        if match:
            skill_id = match.group("skill_id")
            item["package_url"] = f"/api/v1/market/skills/{skill_id}/download"
        elif package_url.startswith("builtin://") and skill_id:
            item["package_url"] = f"/api/v1/market/skills/{skill_id}/download"
        skills.append(item)
    return {**manifest, "skills": skills}


def _session_team_id(session: dict | None) -> str | None:
    if not session:
        return None
    team = str(session.get("team_id") or "").strip()
    return team or None


def _filter_manifest_for_team(manifest: dict, team_id: str | None) -> dict:
    if not team_id:
        return manifest
    filtered = []
    for entry in manifest.get("skills", []):
        skill_id = entry.get("skill_id", "")
        skill = skill_market.get_skill(skill_id)
        if skill is None:
            filtered.append(entry)
            continue
        visibility = skill.get("visibility", "company")
        skill_team = str(skill.get("team_id") or "").strip()
        if visibility == "company" or not skill_team or skill_team == team_id:
            filtered.append(entry)
    return {**manifest, "skills": filtered}


@router.get("/bundles/{bundle_id}/manifest")
async def get_market_bundle_manifest(
    bundle_id: str,
    channel: str = "stable",
    runtime_target: str | None = None,
    session: dict = Depends(require_console_session),
):
    manifest = skill_market.get_bundle_manifest(
        bundle_id,
        channel=channel,
        runtime_target=runtime_target,
    )
    if manifest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="bundle not found")
    scoped = _filter_manifest_for_team(manifest, _session_team_id(session))
    return {"manifest": _employee_manifest(scoped)}


@router.get("/skills")
async def list_market_skills(
    team_id: str | None = None,
    runtime_target: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    limit: int = 100,
    session: dict | None = Depends(require_console_read),
):
    effective_team = team_id or _session_team_id(session)
    return {
        "skills": skill_market.list_market_skills(
            team_id=effective_team,
            runtime_target=runtime_target,
            tag=tag,
            query=query,
            limit=limit,
        )
    }


@router.get("/skills/{skill_id}")
async def get_market_skill(skill_id: str, _session: dict | None = Depends(require_console_read)):
    del _session
    skill = skill_market.get_market_skill(skill_id)
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")
    return {"skill": skill}


@router.get("/skills/{skill_id}/download")
async def download_market_skill(skill_id: str, session: dict | None = Depends(require_console_read)):
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in with a console API key to download skill packages.",
        )
    skill = skill_market.get_skill(skill_id)
    if skill is None or skill.get("status") != "approved":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")
    package = skill_market.resolve_download_package(skill_id)
    if package is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="package not found (upload a zip in /skills or missing builtin skill files)",
        )
    if not skill_market.verify_package_integrity(skill_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="skill package failed integrity or signature verification",
        )
    skill_market.record_download(skill_id)
    path, filename = package
    return FileResponse(path, filename=filename, media_type="application/octet-stream")
