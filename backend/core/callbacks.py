"""生命周期回调"""
import asyncio
import logging
import random
import re
from dataclasses import dataclass
from pathlib import Path

from core.config import load_economy_config, load_evolution_config, load_timeout_config, load_team_config
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


# ── Event Bus ────────────────────────────────────────────────────────────────

@dataclass
class TaskDoneEvent:
    """任务完成事件，携带所有后处理步骤所需的上下文。由 _post_task_pipeline 创建并发布。"""
    agent_id: str
    task_text: str
    difficulty: str
    task_id: str
    response: str
    tool_total: int
    tool_failed: int
    tool_calls: list
    elapsed_ms: int
    done_data: dict
    judge_result: "JudgeResult"


class TaskEventBus:
    """任务完成事件总线。

    订阅的处理器按注册顺序**串行**调用：单个处理器异常被捕获并记录，
    不会阻断其后续处理器的执行——从根本上解决了单点故障问题。

    使用方式::

        bus = TaskEventBus()
        bus.subscribe(my_async_handler)   # handler: async (TaskDoneEvent) -> None
        await bus.publish(event)
    """

    def __init__(self) -> None:
        self._handlers: list = []

    def subscribe(self, handler) -> None:
        """注册一个异步处理器。"""
        self._handlers.append(handler)

    async def publish(self, event: "TaskDoneEvent") -> None:
        """依次调用所有处理器；某个处理器抛出异常时记录错误并继续执行下一个。"""
        for handler in self._handlers:
            try:
                await handler(event)
            except Exception as e:
                logger.error(
                    "[EventBus] handler '%s' failed for agent %s: %s",
                    getattr(handler, "__name__", repr(handler)), event.agent_id, e,
                )


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


async def _trigger_reorganize_background(global_count: int, team_cfg: dict) -> None:
    """后台执行社会重组逻辑并广播结果。

    在正式重组前，对所有在队 agent 运行叛逃检查：
    loyalty 极低的成员可能主动离队，制造戏剧性高光时刻。
    """
    cost_stay = team_cfg.get("cost_stay", 10)
    max_team_ratio = team_cfg.get("max_team_ratio", 0.4)

    # ── 重组前叛逃检查（后台并发执行，异常不阻断主流程）──────────────────────
    try:
        from services.belief_engine import check_and_maybe_defect
        agent_ids = list(arena.agents.keys())
        defection_tasks = [
            check_and_maybe_defect(aid, arena, ws)
            for aid in agent_ids
            if arena.get_agent(aid) and arena.get_agent(aid).team_id
        ]
        if defection_tasks:
            results = await asyncio.gather(*defection_tasks, return_exceptions=True)
            if any(r is True for r in results if not isinstance(r, Exception)):
                _persist()
                logger.info("[reorganize] pre-reorg defection sweep: some agents defected")
    except Exception as e:
        logger.warning("[reorganize] pre-reorg defection check failed: %s", e)

    try:
        result = arena.reorganize_teams(cost_stay=cost_stay, max_team_ratio=max_team_ratio)
        _persist()
        logger.info(
            "[reorganize] 全局任务 #%d：存活 %d 队，解散 %d 队（%s），流民 %d 人，每人扣 %d 军功",
            global_count, len(result.survived_teams), len(result.dissolved_teams),
            "、".join(result.dissolved_team_names) or "无",
            len(result.refugees), result.cost_stay,
        )
        await ws.send_team_reorganized(
            survived_teams=result.survived_teams,
            dissolved_teams=result.dissolved_teams,
            dissolved_team_names=result.dissolved_team_names,
            refugees=result.refugees,
            cost_stay=result.cost_stay,
            global_task_count=global_count,
        )
    except Exception as e:
        logger.error("[reorganize] 重组失败: %s", e)


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


async def _run_judge(
    agent_id: str,
    task_text: str,
    response: str,
    tool_total: int,
    tool_failed: int,
    tool_calls: list,
) -> "JudgeResult":
    """步骤①：调用 LLM Judge，超时后降级到工具成功率兜底。"""
    timeout_cfg = load_timeout_config()
    judge_timeout = timeout_cfg.get("judge_timeout_seconds", 60)
    try:
        result = await asyncio.wait_for(
            judge_task(task_text, response, tool_total, tool_failed, tool_calls=tool_calls),
            timeout=float(judge_timeout),
        )
    except asyncio.TimeoutError:
        logger.warning("[%s] judge LLM timeout after %ds, using fallback", agent_id, judge_timeout)
        success_rate = (tool_total - tool_failed) / max(tool_total, 1)
        score = int(success_rate * 7)
        result = JudgeResult(
            completion=score,
            quality=score,
            efficiency=score,
            reason=f"Judge timeout, fallback based on {success_rate:.0%} tool success rate.",
            skipped=True,
        )
    logger.info(
        "[%s] judge: score=%d reward=%d reason=%s",
        agent_id, result.total_score, result.reward, result.reason,
    )
    return result


async def _run_balance_and_broadcast(
    agent_id: str,
    judge_result: "JudgeResult",
    task_text: str,
    difficulty: str,
    done_data: dict,
) -> None:
    """步骤②：更新余额并广播任务完成事件。"""
    cfg = _economy()
    arena.add_balance(agent_id, judge_result.reward, cfg["initial_balance"])
    a = arena.get_agent(agent_id)
    assert a is not None
    await ws.send_task_complete(
        agent_id,
        judge_result.completion >= 5,
        a.balance,
        judge_result.to_dict(),
        task=task_text,
        difficulty=difficulty,
    )


def _run_record(
    agent_id: str,
    judge_result: "JudgeResult",
    task_text: str,
    difficulty: str,
    task_id: str,
    elapsed_ms: int,
    done_data: dict,
) -> None:
    """步骤③：持久化任务历史记录（含难度统计 + 拒绝次数）。"""
    from core.deps import experiment_id
    arena.record_task_difficulty(agent_id, difficulty)
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


def _run_evolution_check(agent_id: str, judge_result: "JudgeResult") -> None:
    """步骤④：按配置判断是否触发个体进化（后台 task，不 await）。"""
    evo_cfg = load_evolution_config()
    if not evo_cfg["auto_trigger"]:
        return
    a = arena.get_agent(agent_id)
    if a is None:
        return
    count = arena.inc_task_count(agent_id)
    task_failed = judge_result.completion < 5
    interval = evo_cfg["interval_tasks"]
    on_fail = evo_cfg["on_failure"]
    last_evolve = arena.get_last_evolve_at(agent_id)
    periodic = count % interval == 0
    failure_cooldown = evo_cfg.get("failure_cooldown", 1)
    failure_trigger = on_fail and task_failed and (count - last_evolve) >= failure_cooldown
    if periodic or failure_trigger:
        arena.set_last_evolve_at(agent_id, count)
        # ★ 优先用 agent_home；若 fallback 到 chat_dir（含 /chat 后缀），需取其 parent
        agent_home = a.agent_home
        if not agent_home:
            cd = a.chat_dir or ""
            agent_home = str(Path(cd).parent) if cd.rstrip("/").endswith("/chat") else cd
        if agent_home:
            asyncio.create_task(trigger_evolve_background(agent_id, agent_home))


def _run_skill_sharing(agent_id: str, judge_result: "JudgeResult", tool_calls: list) -> None:
    """步骤⑤a：任务成功时，将本次使用的成功工具名写入队伍共享技能池。"""
    if judge_result.completion < 5:
        return  # 任务失败，不共享
    successful_tools: list[str] = []
    seen: set[str] = set()
    for tc in tool_calls:
        if not isinstance(tc, dict):
            continue
        name = tc.get("name", "")
        if name and not tc.get("is_error", False) and name not in seen:
            seen.add(name)
            successful_tools.append(name)
    if not successful_tools:
        return
    arena.add_team_skill(agent_id, successful_tools)
    logger.info("[%s] skill sharing: +%d tool(s) → team pool: %s", agent_id, len(successful_tools), successful_tools)


def _run_social_reorganize() -> None:
    """步骤⑤：全局任务计数 +1，满 N 次触发社会重组（后台 task，不 await）。"""
    global_count = arena.inc_global_task_count()
    team_cfg = load_team_config()
    reorg_interval = team_cfg.get("reorganize_interval_tasks", 20)
    if arena.list_teams() and global_count % reorg_interval == 0:
        asyncio.create_task(_trigger_reorganize_background(global_count, team_cfg))


_LAST_STAND_BALANCE = 30  # 最后一战：复活时给予的余额


async def _generate_last_words(agent_id: str, display_name: str) -> str:
    """调用 LLM 生成一句文言文遗言（30 字以内），带超时兜底。"""
    try:
        from llm_client import social_completion
        prompt = (
            f"你是三国武将【{display_name}】，军功耗尽，即将退出战场。"
            "请用文言文，留下最后一句慷慨激昂的遗言（15-30汉字）。"
            "要求：直接输出遗言正文，不带引号，不带任何说明，语言简练有力。"
        )
        messages = [
            {"role": "system", "content": "你是进化小镇孔明传中的三国武将，即将被淘汰出局。"},
            {"role": "user", "content": prompt},
        ]
        result = await asyncio.wait_for(
            social_completion(messages, temperature=0.85, max_tokens=80),
            timeout=15.0,
        )
        words = (result.get("raw") or "").strip()
        if words and len(words) <= 80:
            return words
    except Exception as e:
        logger.warning("[%s] last words generation failed: %s", agent_id, e)
    return "吾虽败，然志不灭，来世再战。"


async def _run_elimination_check(agent_id: str) -> None:
    """步骤⑥：余额归零时淘汰 agent，但首次触发改为「最后一战」机会。

    流程：
    - 余额 ≤ 0 且 last_stand_used=False → 复活至 30，广播 agent_last_stand + subtitle
    - 余额 ≤ 0 且 last_stand_used=True → LLM 生成遗言 → 正式淘汰 + subtitle
    """
    cfg = _economy()
    a = arena.get_agent(agent_id)
    if a is None or not cfg["eliminate_on_zero"] or a.balance > 0:
        return

    display_name = a.display_name or agent_id

    # ── 首次归零：给予最后一战机会 ──────────────────────────────────────────
    if not a.last_stand_used:
        a.last_stand_used = True
        arena.set_balance(agent_id, _LAST_STAND_BALANCE)
        _persist()
        logger.info("[%s] 最后一战触发：%s 余额恢复至 %d", agent_id, display_name, _LAST_STAND_BALANCE)
        await ws.send_agent_last_stand(agent_id, display_name, _LAST_STAND_BALANCE)
        await ws.send_subtitle_broadcast(
            f"⚔ 最后一战！【{display_name}】垂死挣扎，军功复苏 {_LAST_STAND_BALANCE}",
            level="last_stand",
        )
        return

    # ── 二次归零：生成遗言，正式淘汰 ────────────────────────────────────────
    last_words = await _generate_last_words(agent_id, display_name)
    logger.info("[%s] 遗言：%s", agent_id, last_words)

    from infra.eliminated_agents import append_eliminated
    removed = arena.remove_agent(agent_id)
    if removed:
        append_eliminated(
            agent_id,
            reason="balance_zero",
            final_balance=removed.balance,
            soul_type=removed.soul_type or "balanced",
            display_name=display_name,
        )
        if removed._observer:
            removed._observer.stop()
            await asyncio.to_thread(removed._observer.join, 2)
    await process_mgr.kill(agent_id)
    await ws.send_agent_eliminated(agent_id, "balance_zero")
    await ws.send_subtitle_broadcast(
        f'💀【{display_name}】兵败身死："{last_words}"',
        level="elimination",
    )
    _persist()


async def _run_wisdom_extraction(agent_id: str, task_text: str, judge_reason: str) -> None:
    """步骤⑦a：任务高分成功（completion >= 7）时，LLM 提炼一条文言文战术心得写入队伍共享智慧池。"""
    try:
        from llm_client import social_completion
        a = arena.get_agent(agent_id)
        if a is None:
            return
        agent_name = a.display_name or agent_id
        prompt = (
            f"你是三国武将【{agent_name}】，刚刚高质量完成了以下任务：\n"
            f"任务：{task_text[:200]}\n"
            f"裁判评语：{judge_reason[:300]}\n\n"
            "请用文言文，提炼一条可传授给队友的战术心得（20-50汉字）。"
            "要求：直接输出心得正文，不带引号，不带任何解释，语言简练有力。"
        )
        messages = [
            {"role": "system", "content": "你是进化小镇孔明传中的三国武将，善于总结战术心得。"},
            {"role": "user", "content": prompt},
        ]
        result = await social_completion(messages, temperature=0.7, max_tokens=100)
        wisdom = (result.get("raw") or "").strip()
        if not wisdom or len(wisdom) > 200:
            return
        written = arena.add_team_wisdom(agent_id, wisdom)
        if written:
            logger.info("[%s] wisdom extracted → team pool: %s", agent_name, wisdom[:50])
    except Exception as e:
        logger.warning("[%s] wisdom extraction failed: %s", agent_id, e)


async def _run_agent_message(agent_id: str) -> None:
    """步骤⑦b：双向对话优先 — 优先引用最近未回复的来信生成回复；无来信时主动发起新消息。

    流程：
    1. [优先] 调用 pick_reply_target：找到最近给我发信且我尚未回复的 agent
       → 若找到，调用 generate_and_deliver_message(quote_msg=...) 生成引用回复
    2. [降级] 若无待回复消息，调用 pick_message_targets 随机/队友选目标，主动发起新消息
    """
    try:
        from services.agent_comms import (
            generate_and_deliver_message,
            pick_message_targets,
            pick_reply_target,
        )

        # 优先模式：引用上条来信，升级为双向对话
        reply_target, quote_msg = pick_reply_target(arena, agent_id)
        if reply_target and quote_msg:
            logger.debug("[%s] reply mode → %s", agent_id, reply_target)
            await generate_and_deliver_message(
                arena, ws, agent_id, reply_target, quote_msg=quote_msg
            )
            return

        # 降级模式：无待回复消息，主动发起新消息
        targets = pick_message_targets(arena, agent_id, max_targets=1)
        for target_id in targets:
            await generate_and_deliver_message(arena, ws, agent_id, target_id)
    except Exception as e:
        logger.warning("[%s] agent message step failed: %s", agent_id, e)


async def _run_social_decision(agent_id: str) -> None:
    """步骤⑧：每 N 个任务后 LLM 自主更新 solo_preference / evolution_focus（后台 task）。"""
    try:
        from services.social_decision import maybe_run_social_decision
        task_count = arena.get_task_count(agent_id)
        await maybe_run_social_decision(arena, ws, agent_id, task_count)
    except Exception as e:
        logger.warning("[%s] social decision step failed: %s", agent_id, e)


# ── 事件处理器（每个独立失败，不影响其他）────────────────────────────────────

async def _handler_balance_and_broadcast(event: TaskDoneEvent) -> None:
    """② 更新余额并广播任务完成 WS 事件。"""
    await _run_balance_and_broadcast(
        event.agent_id, event.judge_result, event.task_text, event.difficulty, event.done_data
    )


async def _handler_record_and_context(event: TaskDoneEvent) -> None:
    """③ 持久化历史记录 + 多样性上下文更新 + 技能共享。"""
    _run_record(
        event.agent_id, event.judge_result, event.task_text, event.difficulty,
        event.task_id, event.elapsed_ms, event.done_data,
    )
    task_dispatcher.record_outcome(event.judge_result.completion >= 5)
    _update_evolution_context()
    _run_skill_sharing(event.agent_id, event.judge_result, event.tool_calls)


async def _handler_evolution_check(event: TaskDoneEvent) -> None:
    """④ 个体进化检查。"""
    _run_evolution_check(event.agent_id, event.judge_result)


async def _handler_social_reorganize(event: TaskDoneEvent) -> None:
    """⑤ 社会重组检查。"""
    _run_social_reorganize()


async def _handler_elimination_check(event: TaskDoneEvent) -> None:
    """⑥ 淘汰检查（余额归零时移除 agent）。"""
    await _run_elimination_check(event.agent_id)


async def _handler_social_tasks(event: TaskDoneEvent) -> None:
    """⑦⑧ 知识传承 + Agent 间通信 + 自主社会决策（全部以后台 task 执行）。"""
    if event.judge_result.completion >= 7:
        asyncio.create_task(_run_wisdom_extraction(
            event.agent_id, event.task_text, event.judge_result.reason
        ))
    if event.judge_result.completion >= 5:
        asyncio.create_task(_run_agent_message(event.agent_id))
    asyncio.create_task(_run_social_decision(event.agent_id))


async def _handler_belief_update(event: TaskDoneEvent) -> None:
    """⑨ 文化信仰层：任务完成后更新 loyalty，并检查是否触发叛逃（后台 task）。"""
    asyncio.create_task(_run_belief_update(event.agent_id, event.judge_result.completion >= 5))


async def _run_belief_update(agent_id: str, success: bool) -> None:
    """更新 loyalty（成功/失败事件），再以概率触发叛逃检查。"""
    try:
        from services.belief_engine import update_loyalty, check_and_maybe_defect
        a = arena.get_agent(agent_id)
        if a is None:
            return
        event_type = "task_success" if success else "task_fail"
        update_loyalty(a, event_type)
        defected = await check_and_maybe_defect(agent_id, arena, ws)
        if defected:
            _persist()
    except Exception as e:
        logger.warning("[%s] belief update failed: %s", agent_id, e)


# ── 全局事件总线实例（模块加载时注册，保持注册顺序即执行顺序）──────────────────
_task_event_bus = TaskEventBus()
_task_event_bus.subscribe(_handler_balance_and_broadcast)
_task_event_bus.subscribe(_handler_record_and_context)
_task_event_bus.subscribe(_handler_evolution_check)
_task_event_bus.subscribe(_handler_social_reorganize)
_task_event_bus.subscribe(_handler_elimination_check)
_task_event_bus.subscribe(_handler_social_tasks)
_task_event_bus.subscribe(_handler_belief_update)


async def _post_task_pipeline(
    agent_id: str,
    task_text: str,
    difficulty: str,
    task_id: str,
    response: str,
    tool_total: int,
    tool_failed: int,
    tool_calls: list,
    elapsed_ms: int,
    done_data: dict,
) -> None:
    """任务完成后的处理流水线（事件总线驱动）。

    ① Judge 步骤串行执行（后续步骤依赖其结果），之后通过 _task_event_bus 分发：
    每个处理器独立运行，单个失败不会阻断其他步骤，彻底消除单点故障。
    """
    # ① Judge（串行，其余步骤依赖此结果）
    judge_result = await _run_judge(agent_id, task_text, response, tool_total, tool_failed, tool_calls)
    # ② ~ ⑧ 通过事件总线分发，各处理器隔离失败
    event = TaskDoneEvent(
        agent_id=agent_id,
        task_text=task_text,
        difficulty=difficulty,
        task_id=task_id,
        response=response,
        tool_total=tool_total,
        tool_failed=tool_failed,
        tool_calls=tool_calls,
        elapsed_ms=elapsed_ms,
        done_data=done_data,
        judge_result=judge_result,
    )
    await _task_event_bus.publish(event)


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

    try:
        await _post_task_pipeline(
            agent_id=agent_id,
            task_text=task_text,
            difficulty=meta.get("difficulty", "medium") if meta else "medium",
            task_id=meta.get("task_id", "") if meta else "",
            response=done_data.get("response", ""),
            tool_total=exe.tool_total if exe else 0,
            tool_failed=exe.tool_failed if exe else 0,
            tool_calls=exe.tool_calls if exe else [],
            elapsed_ms=exe.elapsed_ms if exe else 0,
            done_data=done_data,
        )
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


def _trim_system_prompt(prompt: str, max_tokens: int = 2000) -> str:
    """按优先级截断 system prompt，确保不超过 max_tokens token 上限。

    截断策略（优先级从低到高，先移除低优先级内容）：
    1. 移除 ## Social Memory 段落（往来旧信，可再生）
    2. 移除 ## Evolution Focus 段落（进化方向偏好）
    3. 移除 Team Wisdom 子段落（智慧心得，仍保留其余 Team Context）
    4. 兜底：强制按 token 截断（极少触发）

    保证保留（最高优先级）：
    - ## Arena Context（生存压力/经济规则，agent 核心决策依据）
    - ## Incoming Messages（当前任务时段的来信，不可丢弃）
    - ## Team Context（队伍生存状态，弱队警告等）
    """
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
    except ImportError:
        logger.debug("[trim_prompt] tiktoken not installed, skipping truncation")
        return prompt

    def _count(text: str) -> int:
        return len(enc.encode(text))

    if _count(prompt) <= max_tokens:
        return prompt

    # ── 1. 移除 Social Memory（最低优先级，历史可重建）─────────────────────────
    trimmed = re.sub(
        r"\n## Social Memory[^\n]*\n.*?(?=\n## |\Z)",
        "",
        prompt,
        flags=re.DOTALL,
    )
    n = _count(trimmed)
    if n <= max_tokens:
        logger.debug("[trim_prompt] removed Social Memory (%d→%d tokens)", _count(prompt), n)
        return trimmed
    prompt = trimmed

    # ── 2. 移除 Evolution Focus（进化偏好，任务执行期间次要）──────────────────
    trimmed = re.sub(
        r"\n## Evolution Focus[^\n]*\n.*?(?=\n## |\Z)",
        "",
        prompt,
        flags=re.DOTALL,
    )
    n = _count(trimmed)
    if n <= max_tokens:
        logger.debug("[trim_prompt] removed Evolution Focus (%d→%d tokens)", _count(prompt), n)
        return trimmed
    prompt = trimmed

    # ── 3. 移除 Team Wisdom 子段落（保留 Team Context 主体）─────────────────────
    trimmed = re.sub(
        r"\n- Team Wisdom[^\n]*\n.*?(?=\n- |\n## |\Z)",
        "",
        prompt,
        flags=re.DOTALL,
    )
    n = _count(trimmed)
    if n <= max_tokens:
        logger.debug("[trim_prompt] removed Team Wisdom subsection (%d→%d tokens)", _count(prompt), n)
        return trimmed
    prompt = trimmed

    # ── 4. 兜底：强制截断（极少触发）──────────────────────────────────────────
    tokens = enc.encode(prompt)
    if len(tokens) > max_tokens:
        logger.warning(
            "[trim_prompt] force-truncating prompt from %d to %d tokens", len(tokens), max_tokens
        )
        prompt = enc.decode(tokens[:max_tokens])
    return prompt


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


def _format_team_section(team_ctx: dict) -> str:
    """将 get_team_context() 的返回值格式化为 system prompt 片段（英文）。

    示例输出：
    ## Team Context (社会生存压力)
    - You belong to: 蜀汉联盟 (Rank 2 / 3 teams)
    - Your teammates: 赵子龙 (150 merit), 关云长 (80 merit)
    - Team average merit: 115.0 | Global average: 105.0 → Your team is STRONG ✅
    - WARNING: Your team is WEAK ⚠️ — at risk of dissolution at the next reorganization!
    - Tip: Help your team stay above the global average to avoid being disbanded.
    """
    team_name = team_ctx["team_name"]
    rank = team_ctx["team_rank"]
    total = team_ctx["total_teams"]
    team_avg = team_ctx["team_avg"]
    global_avg = team_ctx["global_avg"]
    is_strong = team_ctx["is_strong"]
    teammates = team_ctx["teammates"]

    if teammates:
        mate_str = ", ".join(f"{name} ({bal} merit)" for name, bal in teammates)
    else:
        mate_str = "none (you are the sole member)"

    status_line = (
        f"Team average merit: {team_avg} | Global average: {global_avg} → Your team is STRONG ✅"
        if is_strong
        else (
            f"Team average merit: {team_avg} | Global average: {global_avg} → "
            "Your team is WEAK ⚠️ — at risk of dissolution at the next reorganization!"
        )
    )

    tip = (
        "Keep performing well to maintain your team's strength and pay the maintenance cost."
        if is_strong
        else "Complete tasks successfully to raise your team's average merit and avoid disbandment."
    )

    shared_skills = team_ctx.get("shared_skills", [])
    skills_line = (
        f"\n- Team Experience: Your teammates have succeeded with these tools: "
        f"{', '.join(shared_skills)}. Prefer them when they fit the task."
        if shared_skills else ""
    )

    shared_wisdom = team_ctx.get("shared_wisdom", [])
    wisdom_line = ""
    if shared_wisdom:
        wisdom_items = "\n".join(f"  · {w}" for w in shared_wisdom[-5:])
        wisdom_line = f"\n- Team Wisdom (战术心得，队友亲历总结):\n{wisdom_items}"

    return (
        "\n## Team Context (社会生存压力)\n"
        f"- You belong to: {team_name} (Rank {rank} / {total} teams)\n"
        f"- Your teammates: {mate_str}\n"
        f"- {status_line}\n"
        f"- Tip: {tip}"
        f"{skills_line}"
        f"{wisdom_line}"
    )


def _format_evolution_focus_section(focus: str) -> str:
    """将 agent 的进化方向偏好格式化为 system prompt 片段。"""
    from domain.arena import EVOLUTION_FOCUS_OPTIONS
    if not focus:
        return ""
    desc = EVOLUTION_FOCUS_OPTIONS.get(focus, focus)
    return (
        "\n## Evolution Focus (自选进化方向)\n"
        f"- Your chosen path: **{focus}** — {desc}\n"
        "- Lean into tasks that align with your focus. Specialization builds a stronger identity "
        "and creates complementary diversity within your team."
    )


def _build_context_for_agent(agent_id: str, difficulty: str) -> dict | None:
    """为指定 agent 构建 arena context（含团队社会状态 + 进化方向）。"""
    cfg = _economy()
    if not arena.has_agent(agent_id):
        return None
    a = arena.get_agent(agent_id)
    if a is None:
        return None

    base = _format_arena_context(
        balance=a.balance,
        cost_accept=cfg["cost_accept"],
        reward_complete=cfg["reward_complete"],
        penalty_fail=cfg["penalty_fail"],
        penalty_refuse=cfg.get("penalty_refuse", 0),
        eliminate_on_zero=cfg["eliminate_on_zero"],
        task_difficulty=difficulty,
    )

    # ── 进化方向偏好（若有）─────────────────────────────────────────────────
    if a.evolution_focus:
        base += _format_evolution_focus_section(a.evolution_focus)

    # ── 待读邮件注入（弹出并清空邮箱）──────────────────────────────────────────
    pending_msgs = arena.pop_agent_messages(agent_id)
    if pending_msgs:
        lines = []
        for m in pending_msgs:
            lines.append(f"  [{m['msg_type']}] 来自【{m['from_name']}】: {m['content']}")
        mail_section = (
            "\n## Incoming Messages (来自盟友/对手的传信)\n"
            + "\n".join(lines)
            + "\n- You may factor these messages into your task approach or ignore them."
        )
        base += mail_section

    # ── 社交历史记忆（从持久化日志加载最近3条，给 agent 长期上下文）──────────
    try:
        from infra.social_log import load_recent_received
        history_msgs = load_recent_received(agent_id, limit=3)
        # 只注入不在当前 pending_msgs 中的历史（避免重复）
        pending_contents = {m["content"] for m in pending_msgs}
        history_msgs = [m for m in history_msgs if m.get("content") not in pending_contents]
        if history_msgs:
            hist_lines = [
                f"  [{m.get('msg_type', 'chat')}] 来自【{m.get('from_name', '?')}】: {m.get('content', '')}"
                for m in history_msgs
            ]
            base += (
                "\n## Social Memory (往来旧信，仅供参考)\n"
                + "\n".join(hist_lines)
                + "\n- These are past messages. Use them to understand your social relationships."
            )
    except Exception:
        pass  # 历史记忆加载失败不阻断主流程

    # ── 队伍社会状态 ──────────────────────────────────────────────────────────
    team_ctx = arena.get_team_context(agent_id)
    if team_ctx:
        base += _format_team_section(team_ctx)
    elif a.solo_preference:
        # 主动自由人：强调这是 agent 自己的选择
        base += (
            "\n## Team Context (社会生存压力)\n"
            "- You are a FREE AGENT (自由人) — you have chosen to remain independent.\n"
            "- You will not be assigned to teams during reorganizations unless you change your preference.\n"
            "- Solo path: succeed alone, keep all merits to yourself, but bear all risks without allies."
        )
    else:
        # 被动流民：尚未被分配到队伍
        base += (
            "\n## Team Context (社会生存压力)\n"
            "- You are currently a REFUGEE (流民) — not yet affiliated with any team.\n"
            "- Complete tasks to demonstrate your value and earn a place in a team at the next reorganization."
        )

    # ── Prompt Token 膨胀防护：超过 2000 token 时按优先级截断 ───────────────────
    base = _trim_system_prompt(base, max_tokens=2000)

    return {"append": base}


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

    # 打乱顺序，避免按 agent_id/插入顺序固定优先，实现公平随机分发
    random.shuffle(idle_agents)

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
