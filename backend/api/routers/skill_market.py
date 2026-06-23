"""Private Skills Market API."""
from __future__ import annotations

import binascii

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from core.auth import assert_engine_ingest_scope, get_engine_ingest_auth, require_admin
from core.auth import EngineIngestAuth
from domain.models import (
    SkillBundlePublish,
    SkillCandidateCreate,
    SkillCandidateReview,
    SkillDeprecate,
    SkillPackageUpload,
)
from infra import skill_market
from pydantic import BaseModel as _BaseModel, Field as _Field
from typing import Literal

router = APIRouter(prefix="/api/v1", tags=["skill-market"])


@router.get("/skill-bundles", dependencies=[Depends(require_admin)])
async def list_skill_bundles():
    return {"bundles": skill_market.list_bundles()}


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


@router.post("/skill-bundles/{bundle_id}/publish", dependencies=[Depends(require_admin)])
async def publish_skill_bundle(bundle_id: str, body: SkillBundlePublish):
    try:
        manifest = skill_market.publish_bundle(
            bundle_id,
            channel=body.channel,
            version=body.version,
            runtime_targets=list(body.runtime_targets),
            skill_ids=body.skill_ids,
            include_all_approved=body.include_all_approved,
            team_id=body.team_id,
            runtime_target=body.runtime_target,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"published": True, "manifest": manifest}


@router.get("/skills", dependencies=[Depends(require_admin)])
async def list_skills(
    team_id: str | None = None,
    runtime_target: str | None = None,
    tag: str | None = None,
    status_filter: str | None = None,
    query: str | None = None,
    source_type: str | None = None,
    limit: int = 100,
):
    return {
        "skills": skill_market.list_skills(
            team_id=team_id,
            runtime_target=runtime_target,
            tag=tag,
            status=status_filter,
            query=query,
            source_type=source_type,
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


@router.post("/skill-candidates")
async def create_skill_candidate(
    body: SkillCandidateCreate,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    assert_engine_ingest_scope(auth, body.engine_id)
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


# ── Skill version review (new flow: agent MCP submit → admin review via skill_versions) ──

class SkillVersionReviewBody(_BaseModel):
    decision: Literal["approved", "rejected"]
    reviewer: str = _Field(default="admin", min_length=1, max_length=128)
    reason: str = _Field(default="", max_length=2000)


@router.post("/skill-versions/{version_id}/review", dependencies=[Depends(require_admin)])
async def review_skill_version(version_id: int, body: SkillVersionReviewBody):
    version = skill_market.review_skill_version(
        version_id,
        decision=body.decision,
        reviewer=body.reviewer,
        reason=body.reason,
    )
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="version not found")
    return {"reviewed": True, "version": version}


# ── New unified skill management endpoints ────────────────────────────────────


class DraftSkillBody(_BaseModel):
    skill_id: str = _Field(min_length=1, max_length=128)
    name: str = _Field(min_length=1, max_length=128)
    description: str = _Field(default="", max_length=2000)
    runtime_targets: list[str] = _Field(default_factory=lambda: ["openclaw", "hermes", "skilllite", "custom"])
    team_id: str = _Field(default="", max_length=128)
    tags: list[str] = _Field(default_factory=list)
    source_run_id: str = _Field(default="", max_length=128)
    source_type: str = _Field(default="enterprise", pattern=r"^(enterprise|external)$")


@router.post("/skills/draft", dependencies=[Depends(require_admin)])
async def create_draft_skill(body: DraftSkillBody):
    try:
        skill = skill_market.create_draft_skill(
            skill_id=body.skill_id,
            name=body.name,
            description=body.description,
            runtime_targets=list(body.runtime_targets),
            team_id=body.team_id,
            tags=list(body.tags),
            source_run_id=body.source_run_id,
            source_type=body.source_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"created": True, "skill": skill}


@router.post("/skills/{skill_id}/submit", dependencies=[Depends(require_admin)])
async def submit_skill_for_review(skill_id: str):
    try:
        candidate = skill_market.submit_skill_to_review(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"submitted": True, "candidate": candidate}


@router.get("/skills/{skill_id}", dependencies=[Depends(require_admin)])
async def get_skill_detail(skill_id: str):
    skill = skill_market.get_market_skill(skill_id)
    if skill is None:
        # Try non-market access (draft/pending/etc.)
        skill = skill_market.get_skill(skill_id)
        if skill is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")
        skill["versions"] = skill_market.list_skill_versions(skill_id)
    skill["test_runs"] = skill_market.get_skill_test_runs(skill_id)
    return {"skill": skill}


class SkillTestBody(_BaseModel):
    test_account_id: str = _Field(min_length=1, max_length=128)
    test_prompt: str = _Field(default="", max_length=8000)


@router.post("/skills/{skill_id}/test", dependencies=[Depends(require_admin)])
async def trigger_skill_test(skill_id: str, body: SkillTestBody):
    try:
        result = skill_market.trigger_skill_test(
            skill_id=skill_id,
            test_account_id=body.test_account_id,
            test_prompt=body.test_prompt,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"triggered": True, **result}


@router.get("/skills/{skill_id}/test-runs", dependencies=[Depends(require_admin)])
async def get_skill_test_runs(skill_id: str):
    return {"skill_id": skill_id, "test_runs": skill_market.get_skill_test_runs(skill_id)}

