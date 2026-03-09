"""Agent 间通信服务 — LLM 自动生成 agent 间社交消息，并投递到目标邮箱，通过 WS 广播。

触发时机：任务成功后，由 _post_task_pipeline 的步骤⑦调用（后台 task，不 await）。
消息限制：每次只发一条，内容 20-80 汉字，文言文风格，符合三国主题。
"""
import logging
import random
from datetime import datetime, timezone

from llm_client import social_completion

logger = logging.getLogger("evotown.comms")

# 消息类型及对应的触发条件权重（越高越常见）
_MSG_TYPES = [
    ("strategy",  3),  # 战略建议（最多）
    ("greeting",  2),  # 问候/致敬
    ("alliance",  2),  # 结盟邀约
    ("challenge", 1),  # 挑战/切磋（最少）
    ("chat",      2),  # 闲聊
]
_MSG_POPULATION = [t for t, w in _MSG_TYPES for _ in range(w)]

_TYPE_HINTS = {
    "strategy":  "分享一条对对方有用的战术建议或任务心得",
    "greeting":  "表达敬意或问候，称呼对方的三国武将名号",
    "alliance":  "提出结盟或协作意向，阐明共同利益",
    "challenge": "发出切磋挑战，激励对方精进",
    "chat":      "轻松闲聊，话题不限，体现武将个性",
}


async def generate_and_deliver_message(
    arena,
    ws,
    sender_id: str,
    receiver_id: str,
    *,
    msg_type: str | None = None,
    quote_msg: dict | None = None,
) -> bool:
    """LLM 生成消息内容，投递到接收方邮箱，广播 WS 事件。

    Args:
        arena: Arena 实例。
        ws: WebSocket 广播器。
        sender_id: 发送方 agent ID。
        receiver_id: 接收方 agent ID。
        msg_type: 消息类型（不指定时随机选取）。
        quote_msg: 被引用的原始消息 dict（含 content / from_name 等字段）。
                   传入时生成「引用回复」风格的消息，实现双向对话。

    返回 True 表示成功，False 表示跳过（agent 不存在 / LLM 失败）。
    """
    sender = arena.get_agent(sender_id)
    receiver = arena.get_agent(receiver_id)
    if sender is None or receiver is None:
        return False

    sender_name = sender.display_name or sender_id
    receiver_name = receiver.display_name or receiver_id
    sender_balance = sender.balance
    receiver_balance = receiver.balance

    # ── 引用回复模式 vs 主动发起模式 ─────────────────────────────────────────
    if quote_msg:
        # 双向对话：引用上条来信，生成有明确回应语义的回复
        quoted_content = quote_msg.get("content", "")
        quoted_from = quote_msg.get("from_name", receiver_name)
        msg_type = msg_type or "reply"
        prompt = (
            f"你是三国武将【{sender_name}】，军功值 {sender_balance}。\n"
            f"对方是【{quoted_from}】（即【{receiver_name}】），军功值 {receiver_balance}。\n"
            f"对方曾传信给你：「{quoted_content}」\n\n"
            "请以文言文风格，引用并回应对方上条来信，写出你的回复。\n"
            "要求：\n"
            "- 必须明确引用对方所言（可用「汝上次言…」「汝所云…」「汝所言…深以为然」等句式）\n"
            "- 表达你对其内容的真实看法（赞同/质疑/补充/挑战皆可）\n"
            "- 20-80汉字，一段话，不带引号，不带任何解释，直接输出消息正文。"
        )
        logger.debug(
            "[comms] reply mode: %s → %s quoting: %s",
            sender_name, receiver_name, quoted_content[:40],
        )
    else:
        # 主动发起：随机选消息类型，按原逻辑生成
        msg_type = msg_type or random.choice(_MSG_POPULATION)
        hint = _TYPE_HINTS.get(msg_type, "与对方交流")
        prompt = (
            f"你是三国武将【{sender_name}】，军功值 {sender_balance}。\n"
            f"对方是【{receiver_name}】，军功值 {receiver_balance}。\n"
            f"请以文言文风格，{hint}。\n"
            "要求：20-80汉字，一段话，不带引号，不带任何解释，直接输出消息正文。"
        )

    messages = [
        {"role": "system", "content": "你是进化小镇孔明传中的三国武将，用文言文与其他武将交流。"},
        {"role": "user", "content": prompt},
    ]

    try:
        # max_tokens=400：MiniMax 在 max_tokens 过小或缺失时易截断，Gemini/Qwen 无此问题
        result = await social_completion(messages, temperature=0.85, max_tokens=400)
        content = (result.get("raw") or "").strip()
        if not content or len(content) > 300:
            logger.warning("[comms] LLM returned empty/too-long message, skipping")
            return False
    except Exception as e:
        logger.warning("[comms] LLM message generation failed: %s", e)
        return False

    ts = datetime.now(timezone.utc).isoformat()
    delivered = arena.send_agent_message(sender_id, receiver_id, content, msg_type=msg_type)
    if not delivered:
        return False

    mode_tag = "[reply]" if quote_msg else "[new]"
    logger.info(
        "[comms] %s → %s [%s]%s: %s",
        sender_name, receiver_name, msg_type, mode_tag, content[:40],
    )

    # 持久化到 social_log.jsonl，供重启后恢复社交记忆
    try:
        from infra.social_log import append_social_message
        append_social_message(
            from_id=sender_id,
            from_name=sender_name,
            to_id=receiver_id,
            to_name=receiver_name,
            content=content,
            msg_type=msg_type,
        )
    except Exception as e:
        logger.warning("[comms] social_log persist failed: %s", e)

    try:
        await ws.send_agent_message(
            from_id=sender_id,
            from_name=sender_name,
            to_id=receiver_id,
            to_name=receiver_name,
            content=content,
            msg_type=msg_type,
            ts=ts,
        )
    except Exception as e:
        logger.warning("[comms] WS broadcast failed: %s", e)

    return True


def pick_reply_target(
    arena, sender_id: str, max_age_seconds: float = 3600.0
) -> tuple[str | None, dict | None]:
    """优先选择最近给我发过信且尚未被我回复的 agent，作为引用回复的目标。

    策略：
    1. 从 social_log 读取当前 agent 未回复的来信（时间窗内）
    2. 取最新一条，其 from_id 即为回复目标
    3. 若该 agent 已不在 arena（被淘汰），跳到下一条
    4. 无待回复消息时返回 (None, None)，调用方降级为主动发起新消息

    Returns:
        (receiver_id, quote_msg) 或 (None, None)
    """
    try:
        from infra.social_log import load_pending_replies
        pending = load_pending_replies(sender_id, max_age_seconds=max_age_seconds)
    except Exception as e:
        logger.warning("[comms] load_pending_replies failed: %s", e)
        return None, None

    if not pending:
        return None, None

    # 优先最新的待回复消息（列表末尾），降序遍历
    for recv_msg in reversed(pending):
        from_id = recv_msg.get("from_id", "")
        if from_id and from_id != sender_id and arena.has_agent(from_id):
            return from_id, recv_msg

    return None, None


def pick_message_targets(arena, sender_id: str, max_targets: int = 1) -> list[str]:
    """从队友或随机 agent 中挑选消息接收者（最多 max_targets 人）。
    优先同队队友，其次随机活跃 agent。
    """
    all_agents = list(arena.agents.keys())
    all_agents = [aid for aid in all_agents if aid != sender_id]
    if not all_agents:
        return []

    # 优先同队队友
    team = arena.get_agent_team(sender_id)
    teammates = [aid for aid in (team.members if team else []) if aid != sender_id]
    candidates = teammates if teammates else all_agents

    count = min(max_targets, len(candidates))
    return random.sample(candidates, count)

