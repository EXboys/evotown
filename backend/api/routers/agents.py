"""Agent 路由"""
from fastapi import APIRouter, Depends

from core.auth import require_admin, validate_soul_content
from domain.models import AgentCreate
from services import agent_service

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("")
async def list_agents():
    return await agent_service.list_agents()


@router.post("", dependencies=[Depends(require_admin)])
async def create_agent(body: AgentCreate):
    return await agent_service.create_agent(body)


@router.delete("/{agent_id}", dependencies=[Depends(require_admin)])
async def delete_agent(agent_id: str):
    await agent_service.delete_agent(agent_id)
    return {"ok": True}


@router.post("/{agent_id}/evolve", dependencies=[Depends(require_admin)])
async def trigger_evolve(agent_id: str):
    ok, message = await agent_service.trigger_evolve(agent_id)
    if not ok and message == "agent not found":
        return {"ok": False, "error": message}
    return {"ok": ok, "message": message}


@router.get("/{agent_id}/metrics")
async def get_agent_metrics(agent_id: str, limit: int = 100):
    return await agent_service.get_metrics_data(agent_id, limit)


@router.get("/{agent_id}/decisions")
async def get_agent_decisions(agent_id: str, limit: int = 50):
    return await agent_service.get_decisions_data(agent_id, limit)


@router.get("/{agent_id}/execution_log")
async def get_agent_execution_log(agent_id: str, limit: int = 30):
    """合并执行记录：拒绝 + 已执行，按时间倒序"""
    return await agent_service.get_execution_log_data(agent_id, limit)


@router.get("/{agent_id}/rules")
async def get_agent_rules(agent_id: str):
    return await agent_service.get_rules_data(agent_id)


@router.get("/{agent_id}/prompts")
async def get_agent_prompts(agent_id: str):
    return await agent_service.get_prompts_data(agent_id)


@router.get("/{agent_id}/evolution_log")
async def get_agent_evolution_log(agent_id: str, limit: int = 100):
    return await agent_service.get_evolution_log_data(agent_id, limit)


@router.get("/{agent_id}/skills")
async def get_agent_skills(agent_id: str):
    return await agent_service.get_skills_data(agent_id)


@router.get("/{agent_id}/skills/{skill_name}/content")
async def get_skill_content(agent_id: str, skill_name: str):
    data = await agent_service.get_skill_content(agent_id, skill_name)
    if data is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="skill not found")
    return data


@router.post("/{agent_id}/repair-skills", dependencies=[Depends(require_admin)])
async def repair_agent_skills(agent_id: str):
    """重新从 arena_skills 部署内置技能，修复损坏的符号链接或缺失的技能目录。"""
    ok, msg = await agent_service.repair_skills_action(agent_id)
    if not ok:
        return {"ok": False, "error": msg}
    return {"ok": True, "message": msg}


@router.post("/{agent_id}/skills/{skill_name}/confirm", dependencies=[Depends(require_admin)])
async def confirm_skill(agent_id: str, skill_name: str):
    ok, msg = await agent_service.confirm_skill_action(agent_id, skill_name)
    return {"ok": ok, "message": msg}


@router.post("/{agent_id}/skills/{skill_name}/reject", dependencies=[Depends(require_admin)])
async def reject_skill(agent_id: str, skill_name: str):
    ok, msg = await agent_service.reject_skill_action(agent_id, skill_name)
    return {"ok": ok, "message": msg}


@router.get("/{agent_id}/soul")
async def get_agent_soul(agent_id: str):
    data = await agent_service.get_soul_data(agent_id)
    if data is None:
        return {"error": "agent not found"}
    return data


@router.put("/{agent_id}/soul", dependencies=[Depends(require_admin)])
async def update_agent_soul(agent_id: str, body: dict):
    content = body.get("content", "")
    # 长度 + prompt injection 双重校验（不合规则直接返回 400）
    validate_soul_content(content)
    ok = await agent_service.update_soul(agent_id, content)
    if not ok:
        return {"ok": False, "error": "agent not found"}
    return {"ok": True}
