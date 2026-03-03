"""任务业务服务"""
from core.config import load_economy_config
from core.deps import arena, process_mgr, monitor, ws
from domain.models import TaskInject, TaskBatch


async def inject_task(body: TaskInject) -> tuple[bool, str | None]:
    """返回 (成功, 错误信息)"""
    cfg = load_economy_config()
    ok = await process_mgr.inject_task(body.agent_id, body.task)
    if not ok:
        return False, "agent not found or process dead"
    if arena.has_agent(body.agent_id):
        arena.add_balance(body.agent_id, cfg["cost_accept"], cfg["initial_balance"])
        arena.set_in_task(body.agent_id, True)
        arena.set_pending_task(body.agent_id, body.task)
        monitor.begin_task(body.agent_id, body.task)
    await ws.send_sprite_move(body.agent_id, "广场", "任务中心", "task")
    return True, None


async def batch_inject(body: TaskBatch) -> tuple[int, str | None]:
    """返回 (注入数量, 错误信息)"""
    cfg = load_economy_config()
    target_ids = (
        [body.agent_id] if arena.has_agent(body.agent_id) else []
    ) if body.agent_id != "all" else list(arena.agents.keys())
    if not target_ids:
        return 0, "no agents"
    injected = 0
    for task in body.tasks:
        for aid in target_ids:
            if await process_mgr.inject_task(aid, task):
                injected += 1
                arena.add_balance(aid, cfg["cost_accept"], cfg["initial_balance"])
                arena.set_in_task(aid, True)
                arena.set_pending_task(aid, task)
                monitor.begin_task(aid, task)
                await ws.send_sprite_move(aid, "广场", "任务中心", "task")
    return injected, None
