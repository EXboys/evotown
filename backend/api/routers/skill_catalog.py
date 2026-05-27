"""Skill catalog discovery and import API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from domain.models import SkillCatalogEcosystemImport, SkillCatalogStarterImport
from infra import skill_catalog

router = APIRouter(prefix="/api/v1/skill-catalog", tags=["skill-catalog"])


@router.get("/starter", dependencies=[Depends(require_admin)])
async def list_starter_catalog():
    catalog = skill_catalog.load_starter_catalog()
    return {
        "catalog": catalog,
        "skills": skill_catalog.list_starter_entries(),
    }


@router.post("/starter/import", dependencies=[Depends(require_admin)])
async def import_starter_skills(body: SkillCatalogStarterImport):
    try:
        if body.import_all:
            skills = skill_catalog.import_all_starters(auto_approve=body.auto_approve)
            return {"imported": True, "count": len(skills), "skills": skills}
        if not body.catalog_id:
            raise ValueError("catalog_id is required when import_all is false")
        skill = skill_catalog.import_starter_skill(body.catalog_id, auto_approve=body.auto_approve)
        return {"imported": True, "skill": skill}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/ecosystem", dependencies=[Depends(require_admin)])
async def list_ecosystem_catalog(
    query: str | None = None,
    tag: str | None = None,
    limit: int = 100,
):
    meta = skill_catalog.load_ecosystem_catalog()
    return {
        "catalog": {
            "version": meta.get("version"),
            "source": meta.get("source"),
            "fetched_at": meta.get("fetched_at"),
        },
        "skills": skill_catalog.list_ecosystem_entries(query=query, tag=tag, limit=limit),
    }


@router.post("/ecosystem/sync", dependencies=[Depends(require_admin)])
async def sync_ecosystem_catalog(force_remote: bool = False):
    return skill_catalog.sync_ecosystem_catalog(force_remote=force_remote)


@router.post("/ecosystem/import", dependencies=[Depends(require_admin)])
async def import_ecosystem_skill(body: SkillCatalogEcosystemImport):
    try:
        candidate = skill_catalog.import_ecosystem_skill(
            body.catalog_id,
            runtime_target=body.runtime_target,
        )
        return {"imported": True, "candidate": candidate}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
