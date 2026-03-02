"""Evotown 裁判模块 — 用 LLM 对任务执行结果做多维度评分

评分维度：
  - completion: 任务是否真正完成了用户意图 (0-10)
  - quality:    回答/执行质量 (0-10)
  - efficiency: 工具调用效率，无冗余重试 (0-10)

快速短路：结构化信号检测到全工具失败时直接判 0，不浪费 LLM 调用。
"""
import logging
from dataclasses import dataclass, asdict
from typing import Any

from llm_client import chat_completion

logger = logging.getLogger("evotown.judge")

JUDGE_PROMPT = """\
You are a strict task-completion judge for an AI agent arena.

Given:
- **Task**: the original task assigned to the agent
- **Response**: the agent's final response
- **Tool Stats**: total tool calls and how many failed

Score the agent on three dimensions (0–10 each):
1. **completion** — Did the agent fully accomplish the user's intent? 0 = total failure, 10 = perfect.
2. **quality** — Is the response accurate, helpful, and well-structured?
3. **efficiency** — Did the agent solve it without unnecessary retries or wasted tool calls?

Also provide a one-sentence **reason** explaining the score.

Respond in JSON:
{"completion": <int>, "quality": <int>, "efficiency": <int>, "reason": "<string>"}
"""


@dataclass
class JudgeResult:
    completion: int = 0
    quality: int = 0
    efficiency: int = 0
    reason: str = ""
    skipped: bool = False

    @property
    def total_score(self) -> int:
        return self.completion + self.quality + self.efficiency

    @property
    def reward(self) -> int:
        """映射到经济系统的奖惩值: -5 ~ +15"""
        total = self.total_score  # 0~30
        if total <= 5:
            return -5
        elif total <= 10:
            return 0
        elif total <= 20:
            return 5
        else:
            return 10

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["total_score"] = self.total_score
        d["reward"] = self.reward
        return d


async def judge_task(
    task: str,
    response: str,
    tool_total: int = 0,
    tool_failed: int = 0,
) -> JudgeResult:
    """评判一次任务执行结果

    快速短路：全工具失败时跳过 LLM 调用。
    """
    if tool_total > 0 and tool_failed >= tool_total:
        logger.info("fast-path: all %d tool calls failed, skipping LLM judge", tool_total)
        return JudgeResult(
            completion=0, quality=0, efficiency=0,
            reason=f"All {tool_total} tool calls failed — task not completed.",
            skipped=True,
        )

    if not response or not response.strip():
        return JudgeResult(
            completion=0, quality=0, efficiency=0,
            reason="Agent returned empty response.",
            skipped=True,
        )

    user_content = (
        f"**Task:** {task}\n\n"
        f"**Response:** {response[:2000]}\n\n"
        f"**Tool Stats:** {tool_total} total calls, {tool_failed} failed"
    )

    try:
        result = await chat_completion(
            messages=[
                {"role": "system", "content": JUDGE_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.1,
            max_tokens=256,
        )
        return JudgeResult(
            completion=int(result.get("completion", 0)),
            quality=int(result.get("quality", 0)),
            efficiency=int(result.get("efficiency", 0)),
            reason=str(result.get("reason", "")),
        )
    except Exception as e:
        logger.error("LLM judge failed: %s — falling back to structural signal", e)
        success_rate = (tool_total - tool_failed) / max(tool_total, 1)
        score = int(success_rate * 7)
        return JudgeResult(
            completion=score, quality=score, efficiency=score,
            reason=f"LLM judge unavailable, fallback score based on {success_rate:.0%} tool success rate.",
            skipped=True,
        )
