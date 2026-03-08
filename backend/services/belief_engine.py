"""文化信仰引擎 — 军团宗旨生成 + 忠诚度管理 + 叛逃判定。

三个核心接口：
  generate_team_creed(team, members_info)  → LLM 生成文言文军团宗旨（异步）
  update_loyalty(agent, event_type)        → 根据事件类型调整 loyalty 值（同步）
  check_and_maybe_defect(...)             → loyalty 低于阈值时概率触发叛逃（异步）
"""
import asyncio
import logging
import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from domain.arena import AgentRecord, ArenaState, TeamRecord

logger = logging.getLogger("evotown.belief")

# ── 忠诚度事件权重 ─────────────────────────────────────────────────────────────
_LOYALTY_DELTA: dict[str, int] = {
    "task_success":          +5,   # 本人任务成功，感受到团队价值
    "task_fail":             -8,   # 本人任务失败，对队伍环境产生怀疑
    "teammate_eliminated":  -15,   # 队友阵亡，士气大跌
    "rescue_given":         +10,   # 我施救队友，信仰坚定
    "rescue_received":      +20,   # 队友救我，感激涕零
    "team_disbanded":       -30,   # 所在队伍被解散（弱队），信仰崩溃
    "team_victory":          +8,   # 队伍排名第一次重组后存活，凝聚力增强
}

_LOYALTY_MIN = 0
_LOYALTY_MAX = 100
_DEFECTION_THRESHOLD = 30   # loyalty < 30 时才判断是否叛逃
_DEFECTION_PROB = 0.40      # 触发叛逃的概率（40%）


# ── 忠诚度更新（同步，直接修改 agent 内存状态）───────────────────────────────

def update_loyalty(agent: "AgentRecord", event_type: str) -> int:
    """根据事件类型调整 agent 的 loyalty 值，返回调整后的值。

    loyalty 范围严格限定在 [0, 100] 内，不可溢出。
    """
    delta = _LOYALTY_DELTA.get(event_type, 0)
    if delta == 0:
        logger.debug("[belief] unknown event_type '%s', no loyalty change", event_type)
        return agent.loyalty

    new_val = max(_LOYALTY_MIN, min(_LOYALTY_MAX, agent.loyalty + delta))
    logger.info(
        "[belief] %s loyalty %d → %d (%+d, event=%s)",
        agent.display_name or agent.agent_id, agent.loyalty, new_val, delta, event_type,
    )
    agent.loyalty = new_val
    return new_val


# ── 叛逃判定（异步，需要 arena + ws 执行搬队 + 广播）──────────────────────────

async def check_and_maybe_defect(
    agent_id: str,
    arena: "ArenaState",
    ws,
) -> bool:
    """若 agent loyalty 低于阈值，以 _DEFECTION_PROB 概率触发叛逃。

    叛逃流程：
      1. 从当前队伍移除 agent
      2. 加入军功均值最高的友方/敌方队伍（不含原队伍）
      3. loyalty 重置为 50（新环境，重新开始）
      4. 广播 agent_defected 消息 + subtitle

    返回 True 表示叛逃发生，False 表示未触发。
    """
    a = arena.get_agent(agent_id)
    if a is None or not a.team_id:
        return False  # 流民无队可叛

    if a.loyalty >= _DEFECTION_THRESHOLD:
        return False  # 忠诚度足够，不叛逃

    if random.random() >= _DEFECTION_PROB:
        return False  # 概率未命中

    old_team = arena.get_team(a.team_id)
    if old_team is None:
        return False

    # ── 找最强的非原队伍 ─────────────────────────────────────────────────
    best_team = _find_strongest_other_team(arena, a.team_id)

    display_name = a.display_name or agent_id

    # ── 从原队伍移除 ────────────────────────────────────────────────────
    if agent_id in old_team.members:
        old_team.members.remove(agent_id)
    a.team_id = None

    new_team_id = ""
    new_team_name = "流民"

    if best_team is not None:
        best_team.members.append(agent_id)
        a.team_id = best_team.team_id
        # 重置忠诚度至中立值，在新军团重新积累
        a.loyalty = 50
        new_team_id = best_team.team_id
        new_team_name = best_team.name
    else:
        # 无其他队伍可投奔 → 成为流民
        a.loyalty = 50

    logger.info(
        "[belief] 叛逃！%s (loyalty was %d) 离开【%s】→ 投奔【%s】",
        display_name, _DEFECTION_THRESHOLD - 1, old_team.name, new_team_name,
    )

    # ── 广播叛逃事件 ────────────────────────────────────────────────────
    try:
        await ws.send_agent_defected(
            agent_id=agent_id,
            display_name=display_name,
            old_team_id=old_team.team_id,
            old_team_name=old_team.name,
            new_team_id=new_team_id,
            new_team_name=new_team_name,
        )
        await ws.send_subtitle_broadcast(
            f'🔥【{display_name}】背离【{old_team.name}】，投奔【{new_team_name}】！',
            level="defection",
        )
    except Exception as e:
        logger.warning("[belief] WS broadcast defection failed: %s", e)

    return True


# ── 辅助：找最强非原队伍 ─────────────────────────────────────────────────────

def _find_strongest_other_team(arena: "ArenaState", exclude_team_id: str):
    """返回除 exclude_team_id 外军功均值最高的队伍，若无其他队伍则返回 None。"""
    best = None
    best_avg = -1.0
    for tid, team in arena.teams.items():
        if tid == exclude_team_id or not team.members:
            continue
        total = sum(
            (arena.get_agent(mid).balance if arena.get_agent(mid) else 0)
            for mid in team.members
        )
        avg = total / len(team.members)
        if avg > best_avg:
            best_avg = avg
            best = team
    return best


# ── 军团宗旨生成（异步，LLM 文言文）───────────────────────────────────────────

async def generate_team_creed(team: "TeamRecord", members_info: list[dict]) -> str:
    """用 LLM 为队伍生成一条文言文军团宗旨（20-40汉字）。

    members_info 格式：[{"display_name": str, "soul_type": str}, ...]
    若 LLM 失败或超时，返回空串（调用方负责兜底）。
    """
    try:
        from llm_client import social_completion

        names = "、".join(m.get("display_name", "?") for m in members_info[:5])
        soul_types = "、".join(
            {m.get("soul_type", "balanced") for m in members_info if m.get("soul_type")}
        )
        prompt = (
            f"三国演义中，有一支队伍名为「{team.name}」，\n"
            f"成员为：{names}，性格特质：{soul_types}。\n\n"
            "请为此队伍拟定一条文言文军团宗旨（20-40汉字），\n"
            "要求：意气昂扬，彰显信仰与使命，如「汉室必兴，吾辈当死而后已」。\n"
            "直接输出宗旨正文，不带引号，不带任何解释。"
        )
        messages = [
            {"role": "system", "content": "你是三国时代的谋士，擅长以文言文拟定军团信条。"},
            {"role": "user", "content": prompt},
        ]
        result = await asyncio.wait_for(
            social_completion(messages, temperature=0.8, max_tokens=80),
            timeout=15.0,
        )
        creed = (result.get("raw") or "").strip()
        if creed and 5 < len(creed) <= 100:
            logger.info("[belief] creed generated for 【%s】: %s", team.name, creed)
            return creed
    except asyncio.TimeoutError:
        logger.warning("[belief] creed generation timeout for team %s", team.team_id)
    except Exception as e:
        logger.warning("[belief] creed generation failed for team %s: %s", team.team_id, e)
    return ""
