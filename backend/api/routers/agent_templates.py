"""Agent identity templates API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from core.auth import require_admin
from infra import agent_templates

router = APIRouter(prefix="/api/v1", tags=["agent-templates"])


class TemplateCreate(BaseModel):
    name: str
    description: str = ""
    category: str = "department"
    soul: str = ""
    paradigm: str = ""
    standards: str = ""
    default_model: str = ""
    default_skills: list[str] = Field(default_factory=list)
    has_agent_dir: bool = False
    agent_dir_root: str = "workspace"
    agent_dir_prefix: str = ""


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    soul: str | None = None
    paradigm: str | None = None
    standards: str | None = None
    default_model: str | None = None
    default_skills: list[str] | None = None
    has_agent_dir: bool | None = None
    agent_dir_root: str | None = None
    agent_dir_prefix: str | None = None


@router.get("/agent-templates", dependencies=[Depends(require_admin)])
async def list_templates(category: str = ""):
    return {"templates": agent_templates.list_templates(category)}


@router.post("/agent-templates", dependencies=[Depends(require_admin)])
async def create_template(body: TemplateCreate):
    if body.category == "personal":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="专属模板不可通过 API 创建")
    tpl = agent_templates.create_template(**body.model_dump(exclude_none=True))
    return {"template": tpl}


@router.put("/agent-templates/{template_id}", dependencies=[Depends(require_admin)])
async def update_template(template_id: str, body: TemplateUpdate):
    tpl = agent_templates.get_template(template_id)
    if tpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模板不存在")
    if tpl["category"] == "personal":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="专属模板不可修改")
    fields = body.model_dump(exclude_none=True)
    fields["template_id"] = template_id
    result = agent_templates.update_template(**fields)
    return {"template": result}


@router.delete("/agent-templates/{template_id}", dependencies=[Depends(require_admin)])
async def delete_template(template_id: str):
    if not agent_templates.delete_template(template_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模板不存在")
    return {"ok": True}

