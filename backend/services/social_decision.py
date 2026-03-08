"""自主社会决策服务 — LLM 驱动 agent 自主更新 solo_preference 和 evolution_focus。

触发时机：每 DECISION_INTERVAL_TASKS 个任务后，由 _post_task_pipeline 的步骤⑧调用（后台 task）。
决策内容：
  - solo_preference: 是否保持自由人（true=单干，false=愿意入队）
  - evolution_focus: 进化方向（biases task generation & LLM prompt）
  - reason: 文言文决策理由（广播给前端气泡展示）
"""
import logging
from datetime import datetime, timezone

from domain.arena import EVOLUTION_FOCUS_OPTIONS
from llm_client import social_completion

logger = logging.getLogger("evotown.social")

# 每隔多少个任务触发一次社会自决（可通过 evotown_config.json 中 social.decision_interval 覆盖）
_DEFAULT_DECISION_INTERVAL = 5


def _load_decision_interval() -> int:
    try:
        from core.config import _load_json
        data = _load_json()
        return int(data.get("social", {}).get("decision_interval", _DEFAULT_DECISION_INTERVAL))
    except Exception:
        return _DEFAULT_DECISION_INTERVAL


async def maybe_run_social_decision(
    arena,
    ws,
    agent_id: str,
    task_count: int,
) -> None:
    """若 task_count 满足间隔条件，触发 LLM 社会自决并持久化结果。"""
    interval = _load_decision_interval()
    if task_count % interval != 0:
        return
    try:
        await run_social_decision(arena, ws, agent_id)
    except Exception as e:
        logger.warning("[social] decision failed for %s: %s", agent_id, e)


async def run_social_decision(arena, ws, agent_id: str) -> bool:
    """执行一次 LLM 社会自决：更新 agent 的 solo_preference 和 evolution_focus。
    返回 True 表示成功完成决策。
    """
    a = arena.get_agent(agent_id)
    if a is None:
        return False

    name = a.display_name or agent_id
    balance = a.balance
    team = arena.get_agent_team(agent_id)
    team_info = f"属于队伍【{team.name}】" if team else "当前为流民（无队伍）"
    # 注入军团宗旨（若存在）以强化信仰驱动的决策
    creed_line = ""
    if team and getattr(team, "creed", ""):
        creed_line = f"队伍宗旨：「{team.creed}」\n"
    loyalty_line = ""
    loyalty_val = getattr(a, "loyalty", 100)
    if loyalty_val < 50:
        loyalty_line = f"你对队伍的信仰值已降至 {loyalty_val}/100，内心动摇。\n"
    current_solo = "是（自由人）" if a.solo_preference else "否（愿意入队）"
    current_focus = a.evolution_focus or "无"
    focus_options = "、".join(EVOLUTION_FOCUS_OPTIONS.keys())

    # 近期任务成绩（用军功值变化作粗略代理）
    counts = arena.get_agent_difficulty_counts(agent_id)
    total = sum(counts.values())
    hard = counts.get("hard", 0)

    prompt = (
        f"你是三国武将【{name}】，当前军功值 {balance}，{team_info}。\n"
        f"{creed_line}"
        f"{loyalty_line}"
        f"你已完成 {total} 场任务，其中硬任务 {hard} 场。\n"
        f"当前独行偏好：{current_solo}；当前进化方向：{current_focus}。\n\n"
        "请基于你的处境，做出以下两项自主决策，并以JSON格式输出：\n"
        "1. solo_preference (bool): true=独行，false=愿意入队\n"
        f"2. evolution_focus (str): 从以下选项选一个或留空表示无偏好：{focus_options}\n"
        "3. reason (str): 用文言文说明决策理由，20-60汉字\n\n"
        '示例：{"solo_preference": false, "evolution_focus": "speed", "reason": "..."}\n'
        "只输出JSON，不要其他内容。"
    )
    messages = [
        {"role": "system", "content": "你是进化小镇孔明传中的三国武将，自主决定你的社会策略。"},
        {"role": "user", "content": prompt},
    ]

    try:
        result = await social_completion(messages, temperature=0.6, max_tokens=256)
    except Exception as e:
        logger.warning("[social] LLM call failed for %s: %s", agent_id, e)
        return False

    solo = result.get("solo_preference")
    focus = (result.get("evolution_focus") or "").strip()
    reason = (result.get("reason") or result.get("raw") or "").strip()

    if solo is None and not focus:
        logger.info("[social] %s: no meaningful decision returned, skipping", name)
        return False

    # 合法性校验
    if focus and focus not in EVOLUTION_FOCUS_OPTIONS:
        logger.warning("[social] invalid focus '%s' for %s, clearing", focus, name)
        focus = ""

    prev_focus = a.evolution_focus or ""
    ts = datetime.now(timezone.utc).isoformat()

    # 更新 agent 状态
    if solo is not None:
        a.solo_preference = bool(solo)
    a.evolution_focus = focus

    # 持久化
    try:
        from core.deps import experiment_id
        arena.persist(experiment_id or None)
    except Exception as e:
        logger.warning("[social] persist failed: %s", e)

    logger.info(
        "[social] %s decided: solo=%s focus='%s' (was '%s') reason=%s",
        name, a.solo_preference, focus, prev_focus, reason[:40],
    )

    # WS 广播
    try:
        await ws.send_agent_decision(
            agent_id=agent_id,
            display_name=name,
            solo_preference=a.solo_preference,
            evolution_focus=focus,
            prev_evolution_focus=prev_focus,
            reason=reason,
            ts=ts,
        )
    except Exception as e:
        logger.warning("[social] WS broadcast failed: %s", e)

    return True

