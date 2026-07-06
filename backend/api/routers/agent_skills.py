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
    result = agent_skills.set_agent_skills(agent_id, skill_ids, force=force)
    return result
