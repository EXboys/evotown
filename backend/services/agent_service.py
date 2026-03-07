"""Agent 业务服务"""
import asyncio
from pathlib import Path

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
    get_prompts,
    confirm_skill,
    reject_skill,
)


async def list_agents() -> list[AgentInfo]:
    from core.deps import experiment_id as exp_id
    result = []
    for rec in arena.agents.values():
        stats = await compute_agent_stats(
            rec.agent_id,
            chat_root=rec.chat_dir,
            experiment_id=exp_id or None,
        )
        result.append(AgentInfo(
            id=rec.agent_id,
            display_name=rec.display_name or rec.agent_id,
            chat_dir=rec.chat_dir,
            balance=rec.balance,
            status=rec.status,
            in_task=rec.in_task,
            soul_type=rec.soul_type,
            task_count=stats["task_count"],
            success_count=stats["success_count"],
            evolution_count=stats["evolution_count"],
            evolution_success_count=stats["evolution_success_count"],
        ))
    return result


async def create_agent(body: AgentCreate) -> AgentInfo:
    cfg = load_economy_config()
    agent_id = arena.next_agent_id()
    display_name = arena.assign_display_name()
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
        display_name=display_name,
    )
    arena.add_agent(record)
    await ws.send_agent_created(agent_id, balance, display_name)
    arena.persist()
    return AgentInfo(id=agent_id, chat_dir=chat_root, balance=balance, status="active", soul_type=soul_type)


async def delete_agent(agent_id: str) -> None:
    from infra.eliminated_agents import append_eliminated

    removed = arena.remove_agent(agent_id)
    if removed:
        append_eliminated(
            agent_id,
            reason="user_deleted",
            final_balance=removed.balance,
            soul_type=removed.soul_type or "balanced",
            display_name=removed.display_name or agent_id,
        )
        if removed._observer:
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


async def get_prompts_data(agent_id: str):
    a = arena.get_agent(agent_id)
    if not a:
        return []
    return await get_prompts(a.chat_dir)


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


async def get_skill_content(agent_id: str, skill_name: str) -> dict | None:
    """读取技能的 SKILL.md 和脚本文件内容"""
    a = arena.get_agent(agent_id)
    if not a:
        return None
    agent_home = Path(a.agent_home or a.chat_dir)
    skills_base = agent_home / ".skills"

    # 搜索顺序：_pending → _evolved → 根目录
    candidates = [
        skills_base / "_evolved" / "_pending" / skill_name,
        skills_base / "_evolved" / skill_name,
        skills_base / skill_name,
    ]
    skill_dir = next((p for p in candidates if p.is_dir()), None)
    if skill_dir is None:
        return None

    result: dict = {"name": skill_name, "skill_md": None, "scripts": []}

    skill_md_path = skill_dir / "SKILL.md"
    if skill_md_path.exists():
        result["skill_md"] = skill_md_path.read_text(encoding="utf-8")

    # 读取 scripts/ 目录下所有非 __pycache__ 的源码文件
    scripts_dir = skill_dir / "scripts"
    if scripts_dir.is_dir():
        for f in sorted(scripts_dir.iterdir()):
            if f.is_file() and not f.name.startswith("_") and f.suffix in (".py", ".js", ".ts", ".sh"):
                result["scripts"].append({
                    "filename": f.name,
                    "content": f.read_text(encoding="utf-8"),
                })

    return result


async def repair_skills_action(agent_id: str) -> tuple[bool, str]:
    """重新从 arena_skills 部署所有内置技能到 agent 的 .skills 目录，修复损坏的符号链接。"""
    a = arena.get_agent(agent_id)
    if not a:
        return False, "agent not found"
    agent_home = a.agent_home or a.chat_dir
    ok, msg = process_mgr.repair_skills(agent_home)
    return ok, msg


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
    soul_path = Path(a.agent_home or a.chat_dir) / "SOUL.md"
    soul_path.write_text(content, encoding="utf-8")
    return True


def _archived_chat_root(agent_id: str) -> Path:
    """已淘汰 agent 的 chat 目录（磁盘上可能仍存在）"""
    return Path.home() / ".skilllite" / "arena" / agent_id / "chat"


# 进化「成功」= 产生了规则/技能/示例等产出（rule_added, skill_confirmed 等）
_EVOLUTION_SUCCESS_TYPES = frozenset({
    "rule_added", "skill_confirmed", "example_added", "skill_refined", "skill_pending",
})


async def compute_agent_stats(
    agent_id: str,
    chat_root: str | None = None,
    experiment_id: str | None = None,
) -> dict[str, int]:
    """计算 agent 统计：任务数、成功数、进化次数、进化成功次数。
    任务：task_history 中 outcome=claimed 的记录；进化次数=evolution_run 次数，进化成功=产生规则/技能等的事件数。"""
    from core.deps import experiment_id as exp_id
    exp = experiment_id or exp_id or None

    # 任务：支持 agent_id 或 claimed_by 匹配（兼容旧数据）
    task_history = await asyncio.to_thread(
        load_task_history, exp, agent_id, outcome="claimed", limit=10000
    )
    task_count = len(task_history)
    success_count = sum(1 for h in task_history if h.get("success") is True)

    evolution_count = 0
    evolution_success_count = 0
    chat_path = chat_root or str(_archived_chat_root(agent_id))
    if Path(chat_path).exists():
        evo_log = await get_evolution_log(chat_path, limit=1000)
        # 进化次数 = evolution_run 事件数（实际触发进化的次数）
        evolution_count = sum(
            1 for e in evo_log
            if (e.get("type") or e.get("event_type") or "").strip() == "evolution_run"
        )
        # 进化成功 = 产生规则/技能/示例等产出的事件数
        evolution_success_count = sum(
            1 for e in evo_log
            if (e.get("type") or e.get("event_type") or "").strip() in _EVOLUTION_SUCCESS_TYPES
        )

    return {
        "task_count": task_count,
        "success_count": success_count,
        "evolution_count": evolution_count,
        "evolution_success_count": evolution_success_count,
    }


async def get_eliminated_lifecycle(agent_id: str) -> dict | None:
    """获取已淘汰 agent 的生命周期数据：任务历史、拒绝、进化、决策等。
    数据来自 task_history、execution_log、以及磁盘上的 chat 目录（若仍存在）。
    支持显式归档 agent 及从 task_history/refusals 推断的历史 agent。"""
    from infra.eliminated_agents import load_eliminated

    # 显式归档记录（可选）
    eliminated_list = load_eliminated(limit=500)
    record = next((r for r in eliminated_list if r.get("agent_id") == agent_id), None)

    # 若不在显式归档中，需有 task_history 或 refusals 才可查看
    from core.deps import experiment_id as exp_id
    if not record:
        task_history = await asyncio.to_thread(
            load_task_history, exp_id or None, agent_id, limit=10
        )
        refusals = await asyncio.to_thread(load_refusals, agent_id, limit=10)
        if not task_history and not refusals:
            return None
        # 推断记录：从最后活动时间
        last_ts = 0
        for h in task_history:
            t = h.get("ts", 0)
            try:
                last_ts = max(last_ts, float(t) if isinstance(t, (int, float)) else 0)
            except (ValueError, TypeError):
                pass
        for r in refusals:
            t = r.get("ts", 0)
            try:
                last_ts = max(last_ts, float(t) if isinstance(t, (int, float)) else 0)
            except (ValueError, TypeError):
                pass
        record = {
            "agent_id": agent_id,
            "reason": "inferred",
            "final_balance": None,
            "soul_type": "balanced",
            "ts": last_ts,
        }

    chat_root = str(_archived_chat_root(agent_id))
    chat_exists = _archived_chat_root(agent_id).exists()

    # 任务完成历史（task_history 持久化，按 experiment 过滤）
    from core.deps import experiment_id as exp_id
    task_history = await asyncio.to_thread(
        load_task_history, exp_id or None, agent_id, limit=100
    )
    # 拒绝记录（execution_log 持久化）
    refusals = await asyncio.to_thread(load_refusals, agent_id, limit=100)

    # 若 chat 目录仍存在，可读 evolution_log、decisions、rules、execution_log 合并
    execution_log = []
    evolution_log = []
    decisions = []
    rules = []
    skills = []

    if chat_exists:
        transcript_exec = await asyncio.to_thread(
            get_transcript_executions, chat_root, agent_id, limit=50
        )
        decisions_raw = await get_decisions(chat_root, limit=50)
        decisions = decisions_raw
        evolution_log_raw = await get_evolution_log(chat_root, limit=100)
        evolution_log = list(reversed(evolution_log_raw))
        rules = await get_rules_with_skill_status(
            chat_root, str(_archived_chat_root(agent_id).parent)
        )
        skills = await get_skills(str(_archived_chat_root(agent_id).parent))

        # 合并执行记录（与 get_execution_log_data 类似）
        task_history_by_task = {h.get("task", "").strip(): h for h in task_history if h.get("task")}
        decisions_by_task = {
            (d.get("task_description") or "").strip(): d for d in decisions_raw if d.get("task_description")
        }
        for r in refusals:
            ts = r.get("ts")
            try:
                ts_num = float(ts) if isinstance(ts, (int, float)) else (float(ts) if ts else 0)
            except (ValueError, TypeError):
                ts_num = 0
            execution_log.append({
                "ts": ts, "ts_num": ts_num,
                "task": r.get("task", ""), "status": "refused",
                "refusal_reason": r.get("refusal_reason", ""),
                "difficulty": r.get("difficulty", "medium"),
            })
        for e in transcript_exec:
            task = (e.get("task") or "").strip()
            ts_num = e.get("ts_num", 0)
            h = task_history_by_task.get(task) if task else None
            d = decisions_by_task.get(task) if task else None
            success = h.get("success") if h else e.get("task_completed")
            execution_log.append({
                "ts": e.get("ts"), "ts_num": ts_num,
                "task": task or e.get("task", ""), "status": "executed",
                "task_completed": success if success is not None else True,
                "total_tools": d.get("total_tools", 0) if d else 0,
                "failed_tools": d.get("failed_tools", 0) if d else 0,
                "elapsed_ms": h.get("elapsed_ms") if h else None,
                "id": d.get("id") if d else None,
            })
        execution_log.sort(key=lambda x: x.get("ts_num", 0), reverse=True)
        execution_log = execution_log[:50]
    else:
        # 仅 task_history + refusals
        for r in refusals:
            ts = r.get("ts")
            try:
                ts_num = float(ts) if isinstance(ts, (int, float)) else (float(ts) if ts else 0)
            except (ValueError, TypeError):
                ts_num = 0
            execution_log.append({
                "ts": ts, "ts_num": ts_num,
                "task": r.get("task", ""), "status": "refused",
                "refusal_reason": r.get("refusal_reason", ""),
                "difficulty": r.get("difficulty", "medium"),
            })
        for h in task_history:
            ts = h.get("ts", 0)
            try:
                ts_num = float(ts) if isinstance(ts, (int, float)) else (float(ts) if ts else 0)
            except (ValueError, TypeError):
                ts_num = 0
            execution_log.append({
                "ts": ts, "ts_num": ts_num,
                "task": h.get("task", ""), "status": "executed",
                "task_completed": h.get("success", False),
                "elapsed_ms": h.get("elapsed_ms"),
                "judge": h.get("judge"),
            })
        execution_log.sort(key=lambda x: x.get("ts_num", 0), reverse=True)
        execution_log = execution_log[:50]

    reason = record.get("reason", "unknown")
    if reason == "inferred":
        reason_label = "历史推断"
    elif reason == "balance_zero":
        reason_label = "余额归零"
    else:
        reason_label = "用户删除"

    stats = await compute_agent_stats(agent_id, chat_root if chat_exists else None, exp_id or None)
    return {
        "agent_id": agent_id,
        "reason": reason,
        "reason_label": reason_label,
        "final_balance": record.get("final_balance"),
        "soul_type": record.get("soul_type", "balanced"),
        "eliminated_at": record.get("ts"),
        "chat_exists": chat_exists,
        "task_count": stats["task_count"],
        "success_count": stats["success_count"],
        "evolution_count": stats["evolution_count"],
        "evolution_success_count": stats["evolution_success_count"],
        "task_history": task_history,
        "refusals": refusals,
        "execution_log": execution_log,
        "evolution_log": evolution_log,
        "decisions": decisions,
        "rules": rules,
        "skills": skills,
    }
