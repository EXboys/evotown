"""Evotown 裁判模块 — 用 LLM 对任务执行结果做多维度评分

评分维度：
  - completion: 任务是否真正完成了用户意图 (0-10)
  - quality:    回答/执行质量 (0-10)
  - efficiency: 工具调用效率，无冗余重试 (0-10)

快速短路：结构化信号检测到全工具失败时直接判 0，不浪费 LLM 调用。
"""
import json
import logging
import re
from dataclasses import dataclass, asdict
from typing import Any

from llm_client import judge_completion

logger = logging.getLogger("evotown.judge")

# 常见 LLM 返回的前缀（Gemini 等可能带说明文字）
_JSON_PREFIX_PATTERN = re.compile(
    r"^(?:Here is the JSON requested|Here is the JSON|Here's the JSON|"
    r"The JSON (?:is|requested)|JSON (?:output|response):?|"
    r"Sure,? here(?:'s| is) the JSON:?)\s*\n*",
    re.IGNORECASE,
)
# Gemini 等可能返回 "Here is the JSON requested:\n```json\n{...}"
_JSON_WRAPPER_PATTERN = re.compile(
    r"^(?:Here is the JSON requested:\s*\n?)?```(?:json)?\s*\n?",
    re.IGNORECASE,
)
# 提取 ```json ... ``` 或 ``` ... ``` 之间的内容（含截断情况）
_JSON_CODE_BLOCK_PATTERN = re.compile(
    r"```(?:json)?\s*\n?([\s\S]*?)(?:```|\Z)",
    re.IGNORECASE | re.DOTALL,
)

JUDGE_PROMPT = """\
You are a strict but fair task-completion judge for an AI agent arena.

Given:
- **Task**: the original task assigned to the agent
- **Response**: the agent's final response
- **Tool Calls**: detailed list of each tool call and whether it succeeded or failed

IMPORTANT JUDGING PRINCIPLES:
- **Focus on the FINAL OUTCOME**, not the intermediate process.
- If the agent's final response correctly and fully answers the task, completion should be HIGH (7-10), even if some tool calls failed along the way.
- A failed tool call that was recovered from (e.g., run_code failed but calculator succeeded) should NOT heavily penalize completion or quality.
- Efficiency should reflect whether the agent used reasonable approaches; a single retry or fallback to a different tool is acceptable (score 5-7). Only penalize heavily for many redundant retries.
- An agent that fails one approach but succeeds with another demonstrates adaptability — do NOT treat this as total failure.

Score on three dimensions (0–10 each):
1. **completion** — Did the agent's FINAL RESPONSE fully accomplish the user's intent? 0 = wrong answer or no answer, 10 = perfect and complete.
2. **quality** — Is the final response accurate, clear, and well-structured?
3. **efficiency** — Did the agent solve it with reasonable effort? Minor retries are OK (5-7), excessive waste scores lower.

Also provide a one-sentence **reason** explaining the score.

Respond ONLY with valid JSON, no other text:
{"completion": <int>, "quality": <int>, "efficiency": <int>, "reason": "<string>"}
"""

JUDGE_PROMPT_STRICT = """\
Output ONLY a valid JSON object, nothing else. No explanation, no markdown, no code block.
Format: {"completion": <0-10>, "quality": <0-10>, "efficiency": <0-10>, "reason": "<string>"}
"""


def _extract_json_block(text: str) -> str | None:
    """从文本中提取第一个完整的 JSON 对象（支持嵌套花括号）"""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i, c in enumerate(text[start:], start):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _extract_judge_fields_from_text(text: str) -> dict[str, Any] | None:
    """从文本中用正则提取 completion/quality/efficiency 作为兜底"""
    # 匹配 "completion": 10 或 "completion": 9 等
    m = re.search(r'"completion"\s*:\s*(\d+)', text)
    completion = int(m.group(1)) if m else 0
    m = re.search(r'"quality"\s*:\s*(\d+)', text)
    quality = int(m.group(1)) if m else 0
    m = re.search(r'"efficiency"\s*:\s*(\d+)', text)
    efficiency = int(m.group(1)) if m else 0
    m = re.search(r'"reason"\s*:\s*"((?:[^"\\]|\\.)*)', text)
    reason = (m.group(1) if m else "")[:200]
    if completion or quality or efficiency:
        return {
            "completion": min(10, max(0, completion)),
            "quality": min(10, max(0, quality)),
            "efficiency": min(10, max(0, efficiency)),
            "reason": reason or "Parsed from partial response",
        }
    return None


def _parse_judge_json(raw: str) -> dict[str, Any] | None:
    """从 LLM 原始输出中解析 Judge JSON，支持前缀、markdown、片段提取、截断修复"""
    if not raw or not isinstance(raw, str):
        return None

    # 1. 去除常见前缀
    text = _JSON_PREFIX_PATTERN.sub("", raw).strip()
    # 1b. 去除 "Here is the JSON requested:\n```json\n" 这类包装
    text = _JSON_WRAPPER_PATTERN.sub("", text).strip()

    # 2. 去除 markdown 代码块
    for pattern in (r"^```(?:json)?\s*\n?", r"\n?```\s*$"):
        text = re.sub(pattern, "", text).strip()
    text = text.rstrip("`").strip()

    candidates: list[str] = [text, raw]

    # 2b. 提取 ```json ... ``` 代码块内容（Gemini 常截断，块内可能不完整）
    for m in _JSON_CODE_BLOCK_PATTERN.finditer(raw):
        inner = m.group(1).strip()
        if inner and ("completion" in inner or "{" in inner):
            candidates.insert(0, inner)

    # 3. 提取 {...} 块（支持嵌套）
    block = _extract_json_block(text) or _extract_json_block(raw)
    if block:
        candidates.insert(0, block)

    # 4. 简单首尾 { } 提取（兜底）
    s, e = raw.find("{"), raw.rfind("}")
    if s >= 0 and e > s:
        candidates.append(raw[s : e + 1])

    for candidate in candidates:
        if not candidate.strip():
            continue
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict) and "completion" in parsed:
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass

    # 5. 兜底：从截断/非标准文本中正则提取字段
    return _extract_judge_fields_from_text(raw)


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
        """映射到经济系统的奖惩值: -5 ~ +5

        更平滑的曲线，避免"结果正确但过程有瑕疵"时被过度惩罚。
        0-3   → -5  (完全失败)
        4-8   → -2  (部分完成但有明显问题)
        9-14  →  0  (基本完成)
        15-22 →  3  (良好)
        23-30 →  5  (优秀)
        """
        total = self.total_score  # 0~30
        if total <= 3:
            return -5
        elif total <= 8:
            return -2
        elif total <= 14:
            return 0
        elif total <= 22:
            return 3
        else:
            return 5

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
    tool_calls: list[dict] | None = None,
) -> JudgeResult:
    """评判一次任务执行结果

    快速短路：全工具失败且无有效回复时跳过 LLM 调用。
    """
    has_response = bool(response and response.strip())

    if tool_total > 0 and tool_failed >= tool_total and not has_response:
        logger.info("fast-path: all %d tool calls failed + empty response, skipping LLM judge", tool_total)
        return JudgeResult(
            completion=0, quality=0, efficiency=0,
            reason=f"All {tool_total} tool calls failed and no response — task not completed.",
            skipped=True,
        )

    if not has_response:
        return JudgeResult(
            completion=0, quality=0, efficiency=0,
            reason="Agent returned empty response.",
            skipped=True,
        )

    # Build per-tool detail string
    tool_detail_lines: list[str] = []
    if tool_calls:
        for i, tc in enumerate(tool_calls, 1):
            status = "✗ FAILED" if tc.get("is_error") else "✓ OK"
            name = tc.get("name", "unknown")
            tool_detail_lines.append(f"  {i}. [{status}] {name}")
        tool_section = "**Tool Calls (in order):**\n" + "\n".join(tool_detail_lines)
    else:
        tool_section = f"**Tool Stats:** {tool_total} total calls, {tool_failed} failed"

    user_content = (
        f"**Task:** {task}\n\n"
        f"**Response:** {response[:2000]}\n\n"
        f"{tool_section}"
    )

    try:
        result: dict[str, Any] = {}
        for attempt in range(2):
            prompt = JUDGE_PROMPT_STRICT if attempt == 1 else JUDGE_PROMPT
            api_result = await judge_completion(
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.1,
                max_tokens=256,
                response_format={"type": "json_object"},
            )
            if "raw" not in api_result:
                result = api_result
                break
            raw = str(api_result.get("raw", ""))
            parsed = _parse_judge_json(raw)
            if parsed:
                result = parsed
                break
            logger.warning("Judge LLM returned non-JSON (attempt %d), raw=%s", attempt + 1, raw[:400])
            if attempt == 0:
                continue
            result = {"completion": 0, "quality": 0, "efficiency": 0, "reason": ""}
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
