"""社交消息持久化 — social_log.jsonl

每条 agent 间消息投递成功后追加到此文件，重启后可从中恢复社交记忆。

路径：使用 EVOTOWN_DATA_DIR（Docker 下为 /app/data），与 arena_state 同目录，
确保容器重启后数据不丢失。
"""
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("evotown.social_log")

# 路径配置：优先使用 EVOTOWN_DATA_DIR 环境变量
_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"
_DATA_DIR = Path(os.environ.get("EVOTOWN_DATA_DIR", _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"))
_LOG_PATH = _DATA_DIR / "social_log.jsonl"

# 最多保留最近多少条（写入时不裁剪，读取时限制）
_MAX_LOAD = 200

# ── 日志轮转配置 ─────────────────────────────────────────────────────────────
# 文件超过此大小时触发原子重命名（旧日志保留为 .bak.<timestamp>，新文件自动创建）
_LOG_MAX_BYTES: int = 50 * 1024 * 1024  # 50 MB
# 每追加多少条检查一次文件大小（避免每次写入都调用 stat()）
_ROTATION_CHECK_INTERVAL: int = 100
_append_count: int = 0


def _rotate_if_needed() -> None:
    """若 social_log.jsonl 超过 50 MB，原子重命名为 .bak.<unix_ts> 并开始新文件。"""
    if not _LOG_PATH.exists():
        return
    try:
        size = _LOG_PATH.stat().st_size
        if size < _LOG_MAX_BYTES:
            return
        bak = _LOG_PATH.parent / f"{_LOG_PATH.name}.bak.{int(time.time())}"
        _LOG_PATH.rename(bak)
        logger.info(
            "Rotated social_log.jsonl → %s (%.1f MB)",
            bak.name, size / 1024 / 1024,
        )
    except OSError as e:
        logger.warning("Failed to rotate social log: %s", e)


def append_social_message(
    from_id: str,
    from_name: str,
    to_id: str,
    to_name: str,
    content: str,
    msg_type: str = "chat",
) -> None:
    """追加一条社交消息到 social_log.jsonl。每 100 条检查一次文件大小，超过 50 MB 时自动轮转。"""
    global _append_count
    record: dict[str, Any] = {
        "from_id": from_id,
        "from_name": from_name,
        "to_id": to_id,
        "to_name": to_name,
        "content": content,
        "msg_type": msg_type,
        "ts": time.time(),
    }
    try:
        with open(_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        logger.warning("Failed to append social message: %s", e)
        return
    _append_count += 1
    if _append_count % _ROTATION_CHECK_INTERVAL == 0:
        _rotate_if_needed()


def load_recent_received(agent_id: str, limit: int = 5) -> list[dict[str, Any]]:
    """从 social_log.jsonl 读取最近由 agent_id 收到的消息（最多 limit 条）。

    返回列表按时间升序（旧→新），供 prompt 注入。
    """
    if not _LOG_PATH.exists():
        return []
    records: list[dict[str, Any]] = []
    try:
        with open(_LOG_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    if r.get("to_id") == agent_id:
                        records.append(r)
                except json.JSONDecodeError:
                    continue
        # 只取最近 limit 条，保持时间升序
        return records[-limit:]
    except OSError as e:
        logger.warning("Failed to load social log: %s", e)
        return []


def load_pending_replies(agent_id: str, max_age_seconds: float = 3600.0) -> list[dict[str, Any]]:
    """查找 agent_id 收到的消息中尚未被回复的条目（用于双向对话触发）。

    判断逻辑：
      对每条收到的消息 (from_id → agent_id)，
      检查是否存在 agent_id 在该消息时间戳之后向 from_id 发出的消息。
      若不存在，则该消息为"待回复"状态。

    额外过滤：
      - 仅考虑最近 max_age_seconds 秒内收到的消息（避免反复回复陈旧旧信）
      - 返回列表按时间升序（旧→新）

    Args:
        agent_id: 当前 agent ID（发起回复的一方）
        max_age_seconds: 只看此秒数内的来信，默认 1 小时

    Returns:
        未被回复的来信列表，每条含 from_id / from_name / content / msg_type / ts 等字段。
    """
    if not _LOG_PATH.exists():
        return []

    all_records: list[dict[str, Any]] = []
    try:
        with open(_LOG_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    all_records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError as e:
        logger.warning("Failed to load social log for pending replies: %s", e)
        return []

    now = time.time()
    cutoff = now - max_age_seconds

    # 收到的消息：to_id == agent_id，且在有效时间窗内
    received = [
        r for r in all_records
        if r.get("to_id") == agent_id and r.get("ts", 0) >= cutoff
    ]
    if not received:
        return []

    # 已发出的消息：from_id == agent_id（用于判断是否已回复）
    sent_by_me = [r for r in all_records if r.get("from_id") == agent_id]

    # 对每条收到的消息，检查是否存在回复（agent_id 在 recv.ts 之后向 recv.from_id 发出的消息）
    pending: list[dict[str, Any]] = []
    for recv in received:
        recv_ts = recv.get("ts", 0)
        recv_from = recv.get("from_id", "")
        already_replied = any(
            s.get("to_id") == recv_from and s.get("ts", 0) > recv_ts
            for s in sent_by_me
        )
        if not already_replied:
            pending.append(recv)

    # 时间升序返回，调用方取 [-1] 即最新待回复消息
    pending.sort(key=lambda r: r.get("ts", 0))
    return pending

