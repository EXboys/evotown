"""监控路由"""
from fastapi import APIRouter

from core.deps import experiment_id, monitor
from token_usage import get_usage
from infra.execution_log import load_all_refusals
from infra.eliminated_agents import load_eliminated
from infra.task_history import compute_stats_from_history, load_task_history
from services import agent_service

router = APIRouter(prefix="/monitor", tags=["monitor"])


@router.get("/token_usage")
async def token_usage():
    """Token 消耗统计（裁判评分 + 任务生成等本进程 LLM 调用，不含 Agent 执行）"""
    return get_usage()


@router.get("/active")
async def monitor_active():
    return monitor.active_tasks


@router.get("/history")
async def monitor_history(limit: int = 50):
    return monitor.history[-limit:]


@router.get("/stats")
async def monitor_stats():
    """竞技场统计与裁判评分：优先从持久化 task_history 恢复，后台重启后历史数据不丢失。
    active_tasks 来自内存（当前进行中任务），其余来自 task_history.jsonl。"""
    mem_stats = monitor.stats()
    persisted = compute_stats_from_history(experiment_id=experiment_id)
    return {
        "active_tasks": mem_stats["active_tasks"],
        "total_completed": persisted["total_completed"],
        "success_count": persisted["success_count"],
        "fail_count": persisted["fail_count"],
        "success_rate": persisted["success_rate"],
        "avg_elapsed_ms": persisted["avg_elapsed_ms"],
        # 裁判评分（同样从 task_history 恢复）
        "total_reward": persisted["total_reward"],
        "avg_reward": persisted["avg_reward"],
        "avg_total_score": persisted["avg_total_score"],
        "avg_completion": persisted["avg_completion"],
        "avg_quality": persisted["avg_quality"],
        "avg_efficiency": persisted["avg_efficiency"],
    }


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


async def _merge_eliminated_with_history(limit: int) -> list[dict]:
    """合并：eliminated_agents 显式归档 + task_history/execution_log 中已消失的 agent（不在 arena）"""
    from core.deps import arena, experiment_id
    from services import agent_service

    # 1. 显式归档
    explicit = {r["agent_id"]: r for r in load_eliminated(limit=limit * 2)}
    result = list(explicit.values())

    # 2. 从 task_history 和 execution_log 收集曾出现过的 agent_id
    seen_ids = set(explicit.keys()) | {a.agent_id for a in arena.agents.values()}
    history = load_task_history(experiment_id=experiment_id or None, limit=5000)
    refusals = load_all_refusals(limit=2000)

    for r in history:
        aid = r.get("agent_id") or r.get("claimed_by")
        if aid and aid not in seen_ids:
            seen_ids.add(aid)
            result.append({
                "agent_id": aid,
                "reason": "inferred",
                "final_balance": None,
                "soul_type": "balanced",
                "ts": r.get("ts", 0),
            })
    for r in refusals:
        aid = r.get("agent_id")
        if aid and aid not in seen_ids:
            seen_ids.add(aid)
            result.append({
                "agent_id": aid,
                "reason": "inferred",
                "final_balance": None,
                "soul_type": "balanced",
                "ts": r.get("ts", 0),
            })

    result.sort(key=lambda x: x.get("ts") or 0, reverse=True)
    result = result[:limit]

    # 3. 为每条记录补充 task_count, success_count, evolution_count, evolution_success_count
    for item in result:
        stats = await agent_service.compute_agent_stats(
            item["agent_id"],
            experiment_id=experiment_id or None,
        )
        item["task_count"] = stats["task_count"]
        item["success_count"] = stats["success_count"]
        item["evolution_count"] = stats["evolution_count"]
        item["evolution_success_count"] = stats["evolution_success_count"]

    return result


@router.get("/eliminated_agents")
async def list_eliminated_agents(limit: int = 100):
    """消失的智能体列表（淘汰/删除 + 历史推断），按时间倒序"""
    return await _merge_eliminated_with_history(limit=limit)


@router.get("/eliminated_agents/{agent_id}/lifecycle")
async def get_eliminated_lifecycle(agent_id: str):
    """已淘汰 agent 的生命周期：任务历史、拒绝、进化、决策等"""
    data = await agent_service.get_eliminated_lifecycle(agent_id)
    if data is None:
        return {"error": "agent not found or not eliminated"}
    return data


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
