"""Per-agent skill assignment API (admin only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from infra import agent_skills, agents

router = APIRouter(prefix="/api/v1", tags=["agent-skills"])


@router.get("/agents/{agent_id}/skills", dependencies=[Depends(require_admin)])
async def get_agent_skills(agent_id: str):
    ws = agents.get_agent(agent_id)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    return {
        "agent_id": agent_id,
        "skills": agent_skills.list_for_agent(agent_id),
    }


@router.put("/agents/{agent_id}/skills", dependencies=[Depends(require_admin)])
async def set_agent_skills(agent_id: str, body: dict):
    ws = agents.get_agent(agent_id)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    skill_ids = list(body.get("skills") or [])
    force = bool(body.get("force", False))
    mode = str(body.get("mode", "replace"))
    result = agent_skills.set_agent_skills(agent_id, skill_ids, force=force, mode=mode)
    return result


@router.delete("/agents/{agent_id}/skills/{skill_id}", dependencies=[Depends(require_admin)])
async def remove_agent_skill(agent_id: str, skill_id: str):
    ws = agents.get_agent(agent_id)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    result = agent_skills.undeploy_skill_from_agent(agent_id, skill_id)
    return result


@router.get("/skills/{skill_id}/agent-deployments", dependencies=[Depends(require_admin)])
async def get_skill_agent_deployments(skill_id: str):
    from infra import skill_market
    skill = skill_market.get_skill(skill_id)
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")
    deployments = agent_skills.get_skill_deploy_status(skill_id)
    return {
        "skill_id": skill_id,
        "market_version": skill.get("version", ""),
        "deployments": deployments,
    }


@router.get("/agents/{agent_id}/workspace-skills", dependencies=[Depends(require_admin)])
async def scan_workspace_skills(agent_id: str):
    """Scan agent workspace .evotown/skills/ directory for agent-created skills."""
    from infra import agents as agents_store

    ws = agents_store.get_agent(agent_id)
    if ws is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    root = agents_store.resolve_agent_path(ws)
    skills_dir = root / ".evotown" / "skills"
    if not skills_dir.is_dir():
        return {"agent_id": agent_id, "skills": [], "workspace_root": str(root)}

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

    return {"agent_id": agent_id, "skills": discovered, "workspace_root": str(root)}
