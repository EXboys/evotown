"""Private Skills Market API."""
from __future__ import annotations

import binascii

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from core.auth import require_admin, require_engine_ingest
from domain.models import SkillCandidateCreate, SkillCandidateReview, SkillDeprecate, SkillPackageUpload
from infra import skill_market

router = APIRouter(prefix="/api/v1", tags=["skill-market"])


@router.get("/skill-bundles/{bundle_id}/manifest", dependencies=[Depends(require_admin)])
async def get_skill_bundle_manifest(
    bundle_id: str,
    channel: str = "stable",
    runtime_target: str | None = None,
):
    manifest = skill_market.get_bundle_manifest(
        bundle_id,
        channel=channel,
        runtime_target=runtime_target,
    )
    if manifest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="bundle not found")
    return {"manifest": manifest}


@router.get("/skills", dependencies=[Depends(require_admin)])
async def list_skills(
    team_id: str | None = None,
    runtime_target: str | None = None,
    tag: str | None = None,
    status_filter: str | None = None,
    query: str | None = None,
    limit: int = 100,
):
    return {
        "skills": skill_market.list_skills(
            team_id=team_id,
            runtime_target=runtime_target,
            tag=tag,
            status=status_filter,
            query=query,
            limit=limit,
        )
    }


@router.post("/skill-packages", dependencies=[Depends(require_admin)])
async def upload_skill_package(body: SkillPackageUpload):
    try:
        skill = skill_market.upload_skill_package(body)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid base64 package content") from exc
    return {"uploaded": True, "skill": skill}


@router.post("/skills/{skill_id}/deprecate", dependencies=[Depends(require_admin)])
async def deprecate_skill(skill_id: str, body: SkillDeprecate):
    skill = skill_market.deprecate_skill(skill_id, reason=body.reason, reviewer=body.reviewer)
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")
    return {"deprecated": True, "skill": skill}


@router.get("/skill-packages/{skill_id}/download", dependencies=[Depends(require_admin)])
async def download_skill_package(skill_id: str):
    package = skill_market.get_package_file(skill_id)
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="package not found")
    if not skill_market.verify_package_integrity(skill_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="skill package failed integrity or signature verification",
        )
    skill_market.record_download(skill_id)
    path, filename = package
    return FileResponse(path, filename=filename, media_type="application/octet-stream")


@router.post("/skill-candidates", dependencies=[Depends(require_engine_ingest)])
async def create_skill_candidate(body: SkillCandidateCreate):
    candidate, created = skill_market.create_candidate(body)
    return {"accepted": True, "created": created, "candidate": candidate}


@router.get("/skill-candidates", dependencies=[Depends(require_admin)])
async def list_skill_candidates(
    status_filter: str | None = None,
    team_id: str | None = None,
    engine_id: str | None = None,
    limit: int = 100,
):
    return {
        "candidates": skill_market.list_candidates(
            status=status_filter,
            team_id=team_id,
            engine_id=engine_id,
            limit=limit,
        )
    }


@router.post("/skill-candidates/{candidate_id}/review", dependencies=[Depends(require_admin)])
async def review_skill_candidate(candidate_id: str, body: SkillCandidateReview):
    candidate = skill_market.review_candidate(candidate_id, body)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="candidate not found")
    return {"reviewed": True, "candidate": candidate}

