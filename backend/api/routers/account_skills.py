"""Per-account skill assignment API (admin only)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from infra import account_skills, accounts as accounts_store, workspaces

router = APIRouter(prefix="/api/v1", tags=["account-skills"])

@router.get("/accounts/{account_id}/skills", dependencies=[Depends(require_admin)])
async def get_account_skills(account_id: str):
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    return {"account_id": account_id, "skills": account_skills.list_for_account(account_id)}


@router.put("/accounts/{account_id}/skills", dependencies=[Depends(require_admin)])
async def set_account_skills(account_id: str, body: dict):
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    skill_ids = list(body.get("skills") or [])
    account_skills.assign(account_id, skill_ids)
    return {"account_id": account_id, "skills": account_skills.list_for_account(account_id)}


@router.get("/accounts/{account_id}/workspace-skills", dependencies=[Depends(require_admin)])
async def scan_workspace_skills(account_id: str):
    """Scan workspace .evotown/skills/ directory for agent-created skills."""
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    ws_list = workspaces.list_workspaces(owner_account_id=account_id, limit=1)
    if not ws_list:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no workspace found for account")
    ws = ws_list[0]
    root = workspaces.resolve_workspace_path(ws)
    skills_dir = root / ".evotown" / "skills"
    if not skills_dir.is_dir():
        return {"account_id": account_id, "skills": [], "workspace_root": str(root)}

    discovered: list[dict] = []
    for child in sorted(skills_dir.iterdir()):
        if not child.is_dir():
            continue
        skill_id = child.name
        skill_md = child / "SKILL.md"
        name = skill_id
        description = ""
        if skill_md.is_file():
            try:
                content = skill_md.read_text(encoding="utf-8", errors="replace")
                lines = content.splitlines()
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith("# ") and name == skill_id:
                        name = stripped[2:].strip()
                    if stripped and not stripped.startswith("#"):
                        description = stripped[:500]
                        break
            except Exception:
                pass
        scripts: list[str] = []
        scripts_dir = child / "scripts"
        if scripts_dir.is_dir():
            scripts = [p.name for p in scripts_dir.iterdir() if p.is_file()]
        discovered.append({
            "skill_id": skill_id,
            "name": name,
            "description": description[:500],
            "scripts": scripts,
        })

    return {"account_id": account_id, "skills": discovered, "workspace_root": str(root)}
