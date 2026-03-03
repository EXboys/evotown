"""监控路由"""
from fastapi import APIRouter

from core.deps import experiment_id, monitor
from infra.execution_log import load_all_refusals
from infra.task_history import load_task_history
from services import agent_service

router = APIRouter(prefix="/monitor", tags=["monitor"])


@router.get("/active")
async def monitor_active():
    return monitor.active_tasks


@router.get("/history")
async def monitor_history(limit: int = 50):
    return monitor.history[-limit:]


@router.get("/stats")
async def monitor_stats():
    return monitor.stats()


@router.get("/task_history")
async def get_task_history(
    experiment_id_filter: str | None = None,
    agent_id: str | None = None,
    limit: int = 500,
):
    """任务历史：含认领完成、丢弃、以及每次拒绝记录，按时间排序"""
    exp = experiment_id_filter or experiment_id
    claimed_and_dropped = load_task_history(experiment_id=exp, agent_id=agent_id, limit=limit)
    refusals = load_all_refusals(limit=limit)
    # 将拒绝记录转为统一格式
    refusal_items = [
        {
            "outcome": "refused",
            "agent_id": r.get("agent_id"),
            "task": r.get("task", ""),
            "difficulty": r.get("difficulty", "medium"),
            "ts": r.get("ts", 0),
            "refusal_reason": r.get("refusal_reason", ""),
        }
        for r in refusals
    ]
    # 合并并按 ts 排序（claimed/dropped 有 ts，refused 也有 ts）
    combined = list(claimed_and_dropped) + refusal_items
    combined.sort(key=lambda x: x.get("ts", 0))
    return combined[-limit:]


@router.get("/task_detail")
async def get_task_detail(
    agent_id: str,
    task: str,
    ts: float | None = None,
):
    """任务执行详情：transcript 片段 + decision（工具明细）+ judge"""
    if not agent_id or not task:
        return {"error": "agent_id and task required"}
    detail = await agent_service.get_task_execution_detail(
        agent_id, task, ts_hint=ts
    )
    if detail is None:
        return {"error": "agent not found or no matching execution"}
    return detail
