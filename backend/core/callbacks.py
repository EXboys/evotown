"""生命周期回调"""
import asyncio
import logging
import random

from core.config import load_economy_config, load_evolution_config, load_timeout_config
from core.deps import arena, process_mgr, monitor, task_dispatcher, ws

# 工具名 → 建筑（中文标签）映射：agent 调用工具时进入对应建筑
TOOL_TO_BUILDING: dict[str, str] = {
    # 图书馆：搜索/查询类
    "web_search": "图书馆",
    "web_search_skill": "图书馆",
    "http_request": "图书馆",
    "http-request": "图书馆",
    # 技能工坊：代码执行/计算类
    "skilllite_execute_code": "技能工坊",
    "execute_code": "技能工坊",
    "run_skill": "技能工坊",
    "calculator": "技能工坊",
    "calculator_skill": "技能工坊",
    "run_command": "技能工坊",
    # 档案馆：文件操作类
    "read_file": "档案馆",
    "list_dir": "档案馆",
    "write_file": "档案馆",
    "write_output": "档案馆",
    "list_output": "档案馆",
    "search_replace": "档案馆",
    "insert_lines": "档案馆",
    "grep_files": "档案馆",
    "preview_edit": "档案馆",
    # 记忆仓库：记忆读写类
    "memory_search": "记忆仓库",
    "memory_write": "记忆仓库",
    "memory_list": "记忆仓库",
}
from infra.execution_log import append_refusal, count_refusals_by_task
from infra.task_history import append_task_record
from judge import judge_task
from judge import JudgeResult

logger = logging.getLogger("evotown.callbacks")


def _economy() -> dict:
    return load_economy_config()


def _persist() -> None:
    from core.deps import experiment_id
    arena.persist(experiment_id or None)


async def broadcast_evolution_event(data: dict) -> None:
    """广播进化事件，并对可奖励的进化类型加余额"""
    from core.config import load_economy_config, load_evolution_config

    agent_id = data.get("agent_id", "")
    event_type = data.get("event_type") or data.get("type", "")

    reward = 0
    if agent_id and arena.has_agent(agent_id):
        evo_cfg = load_evolution_config()
        rewards = evo_cfg.get("rewards", {})
        reward = rewards.get(event_type, 0)
        if reward > 0:
            cfg = load_economy_config()
            arena.add_balance(agent_id, reward, cfg["initial_balance"])
            _persist()
            a = arena.get_agent(agent_id)
            if a:
                data["balance"] = a.balance
            data["evolution_reward"] = reward
            logger.info("[%s] evolution reward +%d (%s)", agent_id, reward, event_type)

    await ws.send_evolution_event(**data)


async def trigger_evolve_background(agent_id: str, agent_home: str) -> None:
    try:
        ok, msg = await process_mgr.trigger_evolve(agent_id, agent_home)
        logger.info("[%s] auto evolution %s", agent_id, "ok" if ok else f"failed: {msg[:200]}")
        if ok:
            await ws.send_sprite_move(agent_id, "广场", "进化神殿", "auto_evolution")
    except Exception as e:
        logger.warning("[%s] auto evolution failed: %s", agent_id, e)


def on_agent_event(agent_id: str, event: str, data: dict) -> None:
    monitor.process_event(agent_id, event, data)
    # 工具调用时：agent 进入对应建筑（图书馆/工坊/档案馆/记忆仓库）；仅 tool_call 触发，避免与 tool_result 重复
    if event == "tool_call":
        tool_name = (data.get("name") or "").strip()
        if tool_name:
            building = TOOL_TO_BUILDING.get(tool_name)
            if building:
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(
                        ws.send_sprite_move(agent_id, "广场", building, f"tool_{tool_name}")
                    )
                except RuntimeError:
                    pass


def _update_evolution_context() -> None:
    """将当前所有 agent 的摘要注入 task_dispatcher，引导生成边界任务（超出当前能力一步）。
    使用 arena 可直接获取的数据：
      - rule_count  ← 该 agent 累计完成任务总数（任务越多代表经验越丰富）
      - skill_count ← 该 agent 累计完成的 hard 任务数（硬任务代表高阶技能）
      - success_rate← 近期平均成功率（用 balance/初始余额 作粗略代理）
    """
    cfg = load_economy_config()
    initial = cfg.get("initial_balance", 100) or 100
    summaries = []
    for aid, a in arena.agents.items():
        counts = arena.get_agent_difficulty_counts(aid)
        total_tasks = sum(counts.values())
        hard_tasks = counts.get("hard", 0)
        # 用余额占比作为成功率的粗略代理（余额越高 → 成功率越高）
        success_rate = min(max(a.balance / initial, 0.0), 2.0) / 2.0
        summaries.append({
            "name": a.display_name or aid,
            "rule_count": total_tasks,
            "skill_count": hard_tasks,
            "success_rate": success_rate,
        })
    task_dispatcher.set_evolution_context(summaries)


async def on_task_done(
    agent_id: str,
    success: bool,
    done_data: dict,
    *,
    _exe=None,
    _task_text: str | None = None,
    _meta: dict | None = None,
) -> None:
    """任务完成回调。支持由 process_manager 或任务超时检查器调用。"""
    if not arena.has_agent(agent_id):
        return
    a = arena.get_agent(agent_id)
    if a is None or not a.in_task:
        return  # 幂等：已处理（如超时抢先完成）

    if _exe is not None and _task_text is not None and _meta is not None:
        exe, task_text, meta = _exe, _task_text, _meta
    else:
        exe = monitor.end_task(agent_id)
        meta = arena.pop_pending_task(agent_id)
        task_text = meta["task"] if meta else ""

    response = done_data.get("response", "")
    tool_total = exe.tool_total if exe else 0
    tool_failed = exe.tool_failed if exe else 0

    try:
        timeout_cfg = load_timeout_config()
        judge_timeout = timeout_cfg.get("judge_timeout_seconds", 60)
        try:
            judge_result = await asyncio.wait_for(
                judge_task(task_text, response, tool_total, tool_failed),
                timeout=float(judge_timeout),
            )
        except asyncio.TimeoutError:
            logger.warning("[%s] judge LLM timeout after %ds, using fallback", agent_id, judge_timeout)
            success_rate = (tool_total - tool_failed) / max(tool_total, 1)
            score = int(success_rate * 7)
            judge_result = JudgeResult(
                completion=score,
                quality=score,
                efficiency=score,
                reason=f"Judge timeout, fallback based on {success_rate:.0%} tool success rate.",
                skipped=True,
            )

        logger.info(
            "[%s] judge: score=%d reward=%d reason=%s",
            agent_id,
            judge_result.total_score,
            judge_result.reward,
            judge_result.reason,
        )

        cfg = _economy()
        arena.add_balance(agent_id, judge_result.reward, cfg["initial_balance"])
        a = arena.get_agent(agent_id)
        assert a is not None

        difficulty = meta.get("difficulty", "medium") if meta else "medium"
        await ws.send_task_complete(
            agent_id,
            judge_result.completion >= 5,
            a.balance,
            judge_result.to_dict(),
            task=task_text,
            difficulty=difficulty,
        )
        # 持久化任务/评分历史（含认领者、认领前被拒绝次数）
        task_id = meta.get("task_id", "") if meta else ""
        elapsed_ms = exe.elapsed_ms if exe else 0
        arena.record_task_difficulty(agent_id, difficulty)
        from core.deps import experiment_id
        refusal_counts = count_refusals_by_task()
        refusal_count = refusal_counts.get((task_text or "").strip(), 0)
        append_task_record(
            experiment_id=experiment_id or "unknown",
            task_id=task_id,
            agent_id=agent_id,
            task=task_text,
            difficulty=difficulty,
            judge_result=judge_result.to_dict(),
            elapsed_ms=elapsed_ms,
            success=judge_result.completion >= 5,
            timeout=done_data.get("timeout", False),
            refusal_count=refusal_count,
        )
        _persist()

        # ── 多样性优化：将本次结果反馈给任务分发器 ──────────────────────────
        task_success = judge_result.completion >= 5
        task_dispatcher.record_outcome(task_success)
        _update_evolution_context()

        evo_cfg = load_evolution_config()
        if evo_cfg["auto_trigger"]:
            count = arena.inc_task_count(agent_id)
            task_failed = judge_result.completion < 5
            interval = evo_cfg["interval_tasks"]
            on_fail = evo_cfg["on_failure"]
            last_evolve = arena.get_last_evolve_at(agent_id)
            periodic = count % interval == 0
            failure_cooldown = evo_cfg.get("failure_cooldown", 1)
            failure_trigger = on_fail and task_failed and (count - last_evolve) >= failure_cooldown
            should_evolve = periodic or failure_trigger
            if should_evolve:
                arena.set_last_evolve_at(agent_id, count)
                agent_home = a.agent_home or a.chat_dir
                if agent_home:
                    asyncio.create_task(trigger_evolve_background(agent_id, agent_home))

        if cfg["eliminate_on_zero"] and a.balance <= 0:
            from infra.eliminated_agents import append_eliminated

            removed = arena.remove_agent(agent_id)
            if removed:
                append_eliminated(
                    agent_id,
                    reason="balance_zero",
                    final_balance=removed.balance,
                    soul_type=removed.soul_type or "balanced",
                )
                if removed._observer:
                    removed._observer.stop()
                    await asyncio.to_thread(removed._observer.join, 2)
            await process_mgr.kill(agent_id)
            await ws.send_agent_eliminated(agent_id, "balance_zero")
            _persist()
    finally:
        arena.set_in_task(agent_id, False)


async def check_task_timeouts() -> None:
    """检查并处理超时任务。由 main 的定时任务周期性调用。"""
    timeout_cfg = load_timeout_config()
    timeout_sec = timeout_cfg.get("task_timeout_seconds", 600)
    timed_out = monitor.get_timed_out_agent_ids(timeout_sec)
    for agent_id in timed_out:
        if not arena.has_agent(agent_id):
            continue
        exe = monitor.end_task(agent_id)
        meta = arena.pop_pending_task(agent_id) or {"task": "", "difficulty": "medium", "task_id": ""}
        task_text = meta.get("task", "")
        logger.warning("[%s] task timeout after %ds: %s", agent_id, timeout_sec, task_text[:60])
        await on_task_done(
            agent_id,
            False,
            {"response": "(任务超时)", "task_completed": False, "timeout": True},
            _exe=exe,
            _task_text=task_text,
            _meta=meta,
        )


def get_idle_agents() -> list[str]:
    return arena.get_idle_agent_ids()


def _format_arena_context(
    balance: int,
    cost_accept: int,
    reward_complete: int,
    penalty_fail: int,
    penalty_refuse: int,
    eliminate_on_zero: bool,
    task_difficulty: str,
) -> str:
    """构建 arena 上下文字符串（evotown 特有），供 SkillLite 原样注入 system prompt。"""
    elim = "If it reaches 0, you are eliminated." if eliminate_on_zero else ""
    refuse_line = f" Refusing also costs {penalty_refuse}." if penalty_refuse != 0 else ""
    return (
        "## Arena Context (MANDATORY for task acceptance)\n"
        f"- Your balance: {balance}. {elim}\n"
        f"- Accepting this task costs {cost_accept}. Success: +{reward_complete}, Fail: {penalty_fail}.{refuse_line}\n"
        f"- Task difficulty: {task_difficulty}.\n"
        "**Evolution is your key to survival.** Completing tasks (even with failures) accumulates decisions and triggers evolution. "
        "Evolution rewards: new rule +5, new skill (pending) +4, skill confirmed +12, skill refined +5. "
        "Accept and try tasks to evolve skills — refusing costs balance and blocks evolution."
    )


def _build_context_for_agent(agent_id: str, difficulty: str) -> dict | None:
    """为指定 agent 构建 arena context。"""
    cfg = _economy()
    if not arena.has_agent(agent_id):
        return None
    a = arena.get_agent(agent_id)
    if a is None:
        return None
    return {
        "append": _format_arena_context(
            balance=a.balance,
            cost_accept=cfg["cost_accept"],
            reward_complete=cfg["reward_complete"],
            penalty_fail=cfg["penalty_fail"],
            penalty_refuse=cfg.get("penalty_refuse", 0),
            eliminate_on_zero=cfg["eliminate_on_zero"],
            task_difficulty=difficulty,
        )
    }


async def _inject_and_dispatch(
    agent_id: str, task: str, difficulty: str, task_id: str | None = None
) -> bool:
    """接受后：扣费、注入正式任务、标记。
    注意：不在此处发送 sprite_move，由 on_task_taken → send_task_dispatched 触发，
    确保 task_taken 先到达前端建立 agent→NPC 映射后再移动 agent。
    """
    cfg = _economy()
    context = _build_context_for_agent(agent_id, difficulty)
    ok = await process_mgr.inject_task(agent_id, task, context=context)
    if ok and arena.has_agent(agent_id):
        arena.add_balance(agent_id, cfg["cost_accept"], cfg["initial_balance"])
        arena.set_in_task(agent_id, True)
        arena.set_pending_task(agent_id, task, difficulty=difficulty, task_id=task_id)
        monitor.begin_task(agent_id, task)
    return ok


async def broadcast_preview_and_assign(
    task_id: str, task: str, difficulty: str
) -> str | None:
    """任务板模式：向所有空闲 agent 并发发送预览，先 ACCEPT 者得。返回认领的 agent_id，无人认领则 None。

    强制任务快速路径：若任务被拒绝次数 >= REFUSAL_MANDATORY_THRESHOLD，
    跳过预览直接将任务注入随机空闲 agent，agent 无法拒绝。
    """
    idle_agents = get_idle_agents()
    if not idle_agents:
        return None

    # ── 强制任务快速路径：跳过预览，直接注入 ──────────────────────────────
    if task_dispatcher.is_mandatory_task(task_id):
        chosen = random.choice(idle_agents)
        logger.warning(
            "[MANDATORY] Force-assigning task to [%s] (no preview, no refusal allowed): %s",
            chosen, task[:60],
        )
        ok = await _inject_and_dispatch(chosen, task, difficulty, task_id=task_id)
        return chosen if ok else None

    cfg = _economy()
    assigned: str | None = None

    async def _preview_one(agent_id: str) -> tuple[str, bool, str]:
        context = _build_context_for_agent(agent_id, difficulty)
        accepted, response = await process_mgr.preview_task(agent_id, task, context=context)
        return agent_id, accepted, response or ""

    tasks_map = {asyncio.create_task(_preview_one(aid)): aid for aid in idle_agents}
    pending = set(tasks_map.keys())

    while pending and assigned is None:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for fut in done:
            try:
                agent_id, accepted, response = await fut
            except (asyncio.CancelledError, Exception) as e:
                logger.warning("Preview task failed: %s", e)
                continue
            if assigned is not None:
                if accepted:
                    append_refusal(agent_id, task, difficulty, reason="任务已被他人认领")
                    # 不扣费：agent 尝试接受但任务已被抢，非主动拒绝
                continue
            if accepted:
                assigned = agent_id
                ok = await _inject_and_dispatch(agent_id, task, difficulty, task_id=task_id)
                if ok:
                    logger.info("[%s] grabbed task [%s] (first-come-first-served): %s", agent_id, difficulty, task[:50])
                else:
                    assigned = None
            else:
                append_refusal(agent_id, task, difficulty, reason=response)
                penalty_refuse = cfg.get("penalty_refuse", 0)
                if penalty_refuse != 0 and arena.has_agent(agent_id):
                    arena.add_balance(agent_id, penalty_refuse, cfg["initial_balance"])
                    _persist()
                logger.info("[%s] refused task: %s", agent_id, task[:50])

    for t in pending:
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass

    return assigned


async def dispatch_inject(agent_id: str, task: str, difficulty: str = "medium") -> bool:
    """两阶段任务分发：先预览，agent 接受后再扣费并正式执行。（单 agent 模式，供兼容）"""
    cfg = _economy()
    context = _build_context_for_agent(agent_id, difficulty)

    accepted, response = await process_mgr.preview_task(agent_id, task, context=context)
    if not accepted:
        append_refusal(agent_id, task, difficulty, reason=response or "")
        task_dispatcher.return_task_to_pool(task, difficulty)
        penalty_refuse = cfg.get("penalty_refuse", 0)
        if penalty_refuse != 0 and arena.has_agent(agent_id):
            arena.add_balance(agent_id, penalty_refuse, cfg["initial_balance"])
            _persist()
            logger.info("[%s] refused task, penalty %d, returned to pool: %s", agent_id, penalty_refuse, task[:50])
        else:
            logger.info("[%s] refused task, returned to pool: %s", agent_id, task[:50])
        return False

    return await _inject_and_dispatch(agent_id, task, difficulty)


async def on_dispatched(agent_id: str, task: str, difficulty: str = "medium") -> None:
    await ws.send_task_dispatched(agent_id, task)


async def on_task_available(
    task_id: str, task: str, difficulty: str, created_at: str
) -> None:
    """任务上板时广播，所有人可见。"""
    await ws.send_task_available(task_id, task, difficulty, created_at)


async def on_task_taken(task_id: str, agent_id: str, task: str) -> None:
    """任务被认领时广播。"""
    await ws.send_task_taken(task_id, agent_id, task)
    await ws.send_task_dispatched(agent_id, task)


async def on_task_expired(task_id: str, task: str) -> None:
    """任务 60 分钟无人认领后消失。"""
    await ws.send_task_expired(task_id, task)
