"""Agent 业务服务"""
import asyncio

from core.config import load_economy_config
from core.deps import arena, process_mgr, ws
from core.callbacks import broadcast_evolution_event
from domain.arena import AgentRecord
from domain.models import AgentCreate, AgentInfo
from log_watcher import start_watching
from infra.execution_log import load_refusals
from infra.task_history import load_task_history
from sqlite_reader import (
    get_transcript_executions,
    get_transcript_excerpt_for_task,
    get_decisions,
    get_evolution_log,
    get_metrics,
    get_rules_with_skill_status,
    get_skills,
    confirm_skill,
    reject_skill,
)


def list_agents() -> list[AgentInfo]:
    return [
        AgentInfo(
            id=rec.agent_id,
            chat_dir=rec.chat_dir,
            balance=rec.balance,
            status=rec.status,
            in_task=rec.in_task,
            soul_type=rec.soul_type,
        )
        for rec in arena.agents.values()
    ]


async def create_agent(body: AgentCreate) -> AgentInfo:
    cfg = load_economy_config()
    agent_id = arena.next_agent_id()
    soul_type = body.soul_type or "balanced"
    agent_home, chat_root = await process_mgr.spawn(agent_id, body.chat_dir, soul_type=soul_type)
    loop = asyncio.get_event_loop()
    observer = start_watching(chat_root, agent_id, broadcast_evolution_event, loop)
    balance = cfg["initial_balance"]
    record = AgentRecord(
        agent_id=agent_id,
        agent_home=agent_home,
        chat_dir=chat_root,
        balance=balance,
        status="active",
        in_task=False,
        soul_type=soul_type,
        observer=observer,
    )
    arena.add_agent(record)
    await ws.send_agent_created(agent_id, balance)
    arena.persist()
    return AgentInfo(id=agent_id, chat_dir=chat_root, balance=balance, status="active", soul_type=soul_type)


async def delete_agent(agent_id: str) -> None:
    removed = arena.remove_agent(agent_id)
    if removed and removed._observer:
        removed._observer.stop()
        removed._observer.join(timeout=2)
    await process_mgr.kill(agent_id)
    arena.persist()


async def trigger_evolve(agent_id: str) -> tuple[bool, str]:
    a = arena.get_agent(agent_id)
    if not a:
        return False, "agent not found"
    agent_home = a.agent_home or a.chat_dir
    ok, message = await process_mgr.trigger_evolve(agent_id, agent_home)
    await ws.send_sprite_move(agent_id, "广场", "进化神殿", "forced_evolution")
    return ok, message


async def get_metrics_data(agent_id: str, limit: int = 100):
    a = arena.get_agent(agent_id)
    if not a:
        return []
    return await get_metrics(a.chat_dir, limit)


async def get_decisions_data(agent_id: str, limit: int = 50):
    a = arena.get_agent(agent_id)
    if not a:
        return []
    return await get_decisions(a.chat_dir, limit)


async def get_execution_log_data(agent_id: str, limit: int = 30):
    """合并执行记录：拒绝 + 已执行。优先读 SkillLite transcript（含无工具任务），辅以 task_history/decisions 补充元数据"""
    a = arena.get_agent(agent_id)
    if not a:
        return []

    # 拒绝记录
    refusals = await asyncio.to_thread(load_refusals, agent_id, limit=limit * 2)
    # 执行记录：SkillLite transcript 有完整对话（含无工具直接回答的任务）
    transcript_exec = await asyncio.to_thread(
        get_transcript_executions, a.chat_dir, agent_id, limit=limit * 2
    )
    # 补充：task_history（judge/success）、decisions（工具明细）
    task_history = await asyncio.to_thread(load_task_history, None, agent_id, limit=limit * 2)
    decisions = await get_decisions(a.chat_dir, limit=limit * 2)

    task_history_by_task: dict[str, dict] = {}
    for h in task_history:
        t = (h.get("task") or "").strip()
        if t and t not in task_history_by_task:
            task_history_by_task[t] = h
    decisions_by_task: dict[str, dict] = {}
    for d in decisions:
        desc = (d.get("task_description") or "").strip()
        if desc and desc not in decisions_by_task:
            decisions_by_task[desc] = d

    items = []
    for r in refusals:
        ts = r.get("ts")
        try:
            ts_num = float(ts) if isinstance(ts, (int, float)) else (float(ts) if ts else 0)
        except (ValueError, TypeError):
            ts_num = 0
        items.append({
            "ts": ts,
            "ts_num": ts_num,
            "task": r.get("task", ""),
            "status": "refused",
            "refusal_reason": r.get("refusal_reason", ""),
            "difficulty": r.get("difficulty", "medium"),
        })

    for e in transcript_exec:
        task = (e.get("task") or "").strip()
        ts_num = e.get("ts_num", 0)
        h = task_history_by_task.get(task) if task else None
        d = decisions_by_task.get(task) if task else None
        success = h.get("success") if h else e.get("task_completed")
        items.append({
            "ts": e.get("ts"),
            "ts_num": ts_num,
            "task": task or e.get("task", ""),
            "status": "executed",
            "task_completed": success if success is not None else True,  # 无 judge 时默认完成
            "total_tools": d.get("total_tools", 0) if d else 0,
            "failed_tools": d.get("failed_tools", 0) if d else 0,
            "elapsed_ms": h.get("elapsed_ms") if h else None,
            "id": d.get("id") if d else None,
        })

    items.sort(key=lambda x: x["ts_num"], reverse=True)
    return items[:limit]


async def get_rules_data(agent_id: str):
    a = arena.get_agent(agent_id)
    if not a:
        return []
    return await get_rules_with_skill_status(a.chat_dir, a.agent_home or a.chat_dir)


async def get_evolution_log_data(agent_id: str, limit: int = 100):
    a = arena.get_agent(agent_id)
    if not a:
        return []
    rows = await get_evolution_log(a.chat_dir, limit)
    return list(reversed(rows))


async def get_skills_data(agent_id: str):
    a = arena.get_agent(agent_id)
    if not a:
        return []
    return await get_skills(a.agent_home)


async def confirm_skill_action(agent_id: str, skill_name: str) -> tuple[bool, str]:
    a = arena.get_agent(agent_id)
    if not a:
        return False, "agent not found"
    agent_home = a.agent_home or a.chat_dir
    ok = confirm_skill(agent_home, skill_name)
    if ok:
        await broadcast_evolution_event({
            "agent_id": agent_id,
            "event_type": "skill_confirmed",
            "type": "evolution_event",
            "id": skill_name,
            "reason": "user confirmed via UI",
        })
    return ok, "ok" if ok else "skill not found or already confirmed"


async def reject_skill_action(agent_id: str, skill_name: str) -> tuple[bool, str]:
    a = arena.get_agent(agent_id)
    if not a:
        return False, "agent not found"
    agent_home = a.agent_home or a.chat_dir
    ok = reject_skill(agent_home, skill_name)
    return ok, "ok" if ok else "skill not found"


async def get_task_execution_detail(
    agent_id: str, task_text: str, ts_hint: float | None = None
) -> dict | None:
    """获取某任务的执行详情：transcript 片段 + decision（工具明细）+ task_history（judge）"""
    a = arena.get_agent(agent_id)
    if not a:
        return None

    chat_root = a.chat_dir
    transcript_entries = await asyncio.to_thread(
        get_transcript_excerpt_for_task, chat_root, agent_id, task_text, ts_hint
    )

    decisions = await get_decisions(chat_root, limit=100)
    decision = None
    for d in decisions:
        desc = (d.get("task_description") or "").strip()
        if desc and (desc == task_text or task_text in desc):
            decision = d
            break

    task_history = await asyncio.to_thread(
        load_task_history, None, agent_id, limit=100
    )
    th_record = None
    for h in task_history:
        t = (h.get("task") or "").strip()
        if t and (t == task_text or task_text in t):
            th_record = h
            break

    return {
        "agent_id": agent_id,
        "task": task_text,
        "transcript": transcript_entries,
        "decision": decision,
        "task_history": th_record,
    }


async def get_soul_data(agent_id: str) -> dict | None:
    """获取 agent 的 Soul 内容"""
    a = arena.get_agent(agent_id)
    if not a:
        return None
    from pathlib import Path
    soul_path = Path(a.agent_home or a.chat_dir) / "SOUL.md"
    if not soul_path.exists():
        return {"content": "", "soul_type": a.soul_type}
    content = soul_path.read_text(encoding="utf-8")
    return {"content": content, "soul_type": a.soul_type}


async def update_soul(agent_id: str, content: str) -> bool:
    """更新 agent 的 Soul 内容"""
    a = arena.get_agent(agent_id)
    if not a:
        return False
    from pathlib import Path
    soul_path = Path(a.agent_home or a.chat_dir) / "SOUL.md"
    soul_path.write_text(content, encoding="utf-8")
    return True
