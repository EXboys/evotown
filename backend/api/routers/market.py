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
        package_url = item.get("package_url", "")
        match = _ADMIN_PACKAGE_RE.match(package_url)
        if match:
            skill_id = match.group("skill_id")
            item["package_url"] = f"/api/v1/market/skills/{skill_id}/download"
        skills.append(item)
    return {**manifest, "skills": skills}


@router.get("/bundles/{bundle_id}/manifest")
async def get_market_bundle_manifest(
    bundle_id: str,
    channel: str = "stable",
    runtime_target: str | None = None,
    session: dict = Depends(require_console_session),
):
    del session
    manifest = skill_market.get_bundle_manifest(
        bundle_id,
        channel=channel,
        runtime_target=runtime_target,
    )
    if manifest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="bundle not found")
    return {"manifest": _employee_manifest(manifest)}


@router.get("/skills")
async def list_market_skills(
    team_id: str | None = None,
    runtime_target: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    limit: int = 100,
    _session: dict | None = Depends(require_console_read),
):
    del _session
    return {
        "skills": skill_market.list_market_skills(
            team_id=team_id,
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
    package = skill_market.get_package_file(skill_id)
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="package not found")
    skill_market.record_download(skill_id)
    path, filename = package
    return FileResponse(path, filename=filename, media_type="application/octet-stream")
