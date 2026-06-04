"""组织运行日报服务 — 按周期汇总 Agent 运行与协作情况

期次命名：第 N 期（连续递增，重启不丢失）
报告周期：最近 period_hours 小时（默认 5h），展示为真实日历时间段
输出文件：data/chronicle/chapter_NNNN.json
触发方式：
  - 手动：POST /chronicle/generate
  - 自动：main.py lifespan 定时任务（CHRONICLE_INTERVAL_HOURS，默认 5h）
"""
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any

logger = logging.getLogger("evotown.chronicle")


def _strip_think_blocks(text: str) -> str:
    """移除 MiniMax 等模型的 <think>...</think> 块，只保留正文。"""
    if not text or not isinstance(text, str):
        return text or ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"
_DATA_DIR = Path(os.environ.get("EVOTOWN_DATA_DIR", _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"))

_CHRONICLE_DIR = Path(__file__).parent.parent / "data" / "chronicle"
_CHAPTER_META_PATH = Path(__file__).parent.parent / "data" / "chronicle_chapter.json"
_TASK_HISTORY_PATH = _DATA_DIR / "task_history.jsonl"
_EXEC_LOG_PATH = _DATA_DIR / "execution_log.jsonl"
def _display_tz() -> ZoneInfo:
    from core.config import load_display_config

    return ZoneInfo(load_display_config()["timezone"])


def _load_chapter_counter() -> int:
    if _CHAPTER_META_PATH.exists():
        try:
            return int(json.loads(_CHAPTER_META_PATH.read_text(encoding="utf-8")).get("chapter", 0))
        except Exception:
            pass
    return 0


def _save_chapter_counter(chapter: int) -> None:
    _CHAPTER_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CHAPTER_META_PATH.write_text(
        json.dumps({"chapter": chapter}, ensure_ascii=False), encoding="utf-8"
    )


def _next_chapter() -> int:
    chapter = _load_chapter_counter() + 1
    _save_chapter_counter(chapter)
    return chapter


def current_chapter() -> int:
    return _load_chapter_counter()


def _chapter_label(chapter_n: int) -> str:
    return f"第 {chapter_n} 期"


def _report_period_label(start_ts: float, end_ts: float) -> str:
    tz = _display_tz()
    start = datetime.fromtimestamp(start_ts, tz=tz)
    end = datetime.fromtimestamp(end_ts, tz=tz)
    if start.date() == end.date():
        return f"{start.strftime('%Y年%m月%d日')} {start.strftime('%H:%M')}–{end.strftime('%H:%M')}"
    return f"{start.strftime('%Y-%m-%d %H:%M')} – {end.strftime('%Y-%m-%d %H:%M')}"


def _period_bounds(period_hours: int = 5) -> tuple[float, float]:
    end_ts = time.time()
    return end_ts - period_hours * 3600, end_ts


def _load_jsonl_for_window(path: Path, start_ts: float, end_ts: float) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    ts = r.get("ts", 0.0)
                    if start_ts <= ts < end_ts:
                        records.append(r)
                except json.JSONDecodeError:
                    continue
    except OSError as e:
        logger.warning("chronicle: load %s failed: %s", path.name, e)
    return records


def _resolve_name(agent_id: str, name_map: dict[str, str]) -> str:
    name = name_map.get(agent_id, "")
    if name and name != agent_id:
        return name
    if len(agent_id) > 16:
        return f"Agent-{agent_id[:8]}"
    return agent_id or "未知 Agent"


def _load_eliminated_name_map() -> dict[str, str]:
    try:
        from infra.eliminated_agents import load_eliminated
        return {r["agent_id"]: r["display_name"] for r in load_eliminated() if r.get("agent_id") and r.get("display_name")}
    except Exception:
        return {}


def _build_chapter_summary(
    chapter_n: int,
    start_ts: float,
    end_ts: float,
    agent_name_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    tasks = [r for r in _load_jsonl_for_window(_TASK_HISTORY_PATH, start_ts, end_ts) if r.get("outcome") == "claimed"]
    exec_logs = _load_jsonl_for_window(_EXEC_LOG_PATH, start_ts, end_ts)
    name_map = {**_load_eliminated_name_map(), **(agent_name_map or {})}

    agent_stats: dict[str, dict[str, Any]] = {}

    def _agent(aid: str) -> dict[str, Any]:
        if aid not in agent_stats:
            agent_stats[aid] = {
                "agent_id": aid,
                "display_name": _resolve_name(aid, name_map),
                "completed": 0, "failed": 0, "total_reward": 0,
                "best_task": "", "best_score": -999, "judge_reasons": [],
            }
        return agent_stats[aid]

    for r in tasks:
        aid = r.get("agent_id", "")
        s = _agent(aid)
        judge = r.get("judge") or {}
        reward = judge.get("reward", 0)
        score = judge.get("total_score", 0)
        reason = (judge.get("reason") or "").strip()
        success = r.get("success", False)
        if success:
            s["completed"] += 1
        else:
            s["failed"] += 1
        s["total_reward"] += reward
        if score > s["best_score"]:
            s["best_score"] = score
            s["best_task"] = r.get("task", "")
        if reason and len(reason) > 20:
            s["judge_reasons"].append(reason[:200])

    refusals: dict[str, int] = {}
    for r in exec_logs:
        if r.get("status") == "refused":
            aid = r.get("agent_id", "")
            refusals[aid] = refusals.get(aid, 0) + 1

    ranking = sorted(agent_stats.values(), key=lambda x: x["total_reward"], reverse=True)
    highlights = [
        {
            "display_name": name_map.get(r.get("agent_id", ""), r.get("agent_id", "")),
            "task": r.get("task", ""),
            "success": r.get("success", False),
            "reason": (r.get("judge") or {}).get("reason", "")[:300],
        }
        for r in tasks if len((r.get("judge") or {}).get("reason", "")) > 30
    ][:5]

    return {
        "chapter": chapter_n,
        "total_tasks": len(tasks),
        "total_completed": sum(1 for r in tasks if r.get("success")),
        "total_failed": sum(1 for r in tasks if not r.get("success")),
        "agent_stats": ranking,
        "refusals_by_agent": refusals,
        "highlights": highlights,
    }


_SYSTEM_PROMPT = """你是 Evotown 企业 Agent 平台的运营分析撰写员。

【职责】
根据本期 Agent 运行数据，撰写简洁、专业的组织运行日报，供管理者与团队阅读。

【写法要求】
- 商务书面语，客观克制；禁止小说、章回体、武侠、三国、演义等修辞；
- 开篇点明报告周期与整体概况（任务量、完成率、主要亮点）；
- 正文 2–3 段：① 整体运行与协作态势 ② 1–2 名表现突出的 Agent 及典型任务 ③ 失败案例、风险或改进建议（若有）；
- 使用「任务」「完成」「失败」「贡献/绩效」等术语；不要用「军令」「告捷」「兵败」「军功」「武将」「孔明」等词；
- 直接使用 Agent 展示名，禁止 agent_id 或英文内部标识；
- 400–550 字，段落清晰，段间空一行；
- 禁止 markdown 符号（#/*/-/```）、过度括号与 emoji。

禁止：任何三国人物名、虚拟古代纪年、对联式「正是：」收尾。"""


def _build_chapter_prompt(chapter_n: int, period_label: str, summary: dict[str, Any]) -> str:
    chapter_label = _chapter_label(chapter_n)
    no_data = summary["total_tasks"] == 0

    lines = [
        f"以下是 Evotown 组织运行数据【{period_label}】（{chapter_label}），请据此生成企业运行日报：\n",
        f"本期任务总数：{summary['total_tasks']}，完成：{summary['total_completed']}，失败：{summary['total_failed']}\n",
    ]
    if no_data:
        lines.append(
            "【特别说明】本期无任务运行记录。"
            "请写一份简短的空窗期运行说明：团队 Agent 处于待命/低负载状态，可提及后续关注重点，约 300–400 字。"
        )
    if summary["agent_stats"]:
        lines.append("【Agent 贡献排行（直接用展示名写入正文）】")
        for i, s in enumerate(summary["agent_stats"][:8], 1):
            refusals = summary["refusals_by_agent"].get(s["agent_id"], 0)
            line = (f"{i}. {s['display_name']}：绩效 {s['total_reward']:+d}，"
                    f"完成 {s['completed']} 次，失败 {s['failed']} 次")
            if refusals:
                line += f"，拒接任务 {refusals} 次"
            if s["best_task"]:
                line += f"，代表任务：「{s['best_task'][:30]}」"
            lines.append(line)
    if summary["highlights"]:
        lines.append("\n【典型任务（融入正文，勿逐条照搬）】")
        for h in summary["highlights"]:
            outcome = "完成" if h["success"] else "失败"
            lines.append(f"- {h['display_name']} 执行「{h['task'][:40]}」{outcome}：{h['reason'][:120]}")
    lines.append(
        f"\n请据上述数据撰写 {chapter_label} 组织运行日报。"
        f"报告周期：{period_label}。"
        f"400–550 字，结构清晰，突出贡献最高 Agent 与可执行洞察。"
        f"禁止：英文、agent_id、markdown、三国/章回体/古代纪年。"
    )
    return "\n".join(lines)


_TITLE_SYSTEM_PROMPT = (
    "你是企业运营简报编辑。根据运行日报正文，生成一行简洁标题（15–28 个汉字），"
    "概括本期最核心的结论。只输出标题本身，不要引号或解释。"
)


def chronicle_path(chapter_n: int) -> Path:
    return _CHRONICLE_DIR / f"chapter_{chapter_n:04d}.json"


def load_chronicle(chapter_n: int) -> dict[str, Any] | None:
    p = chronicle_path(chapter_n)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("chronicle: load chapter %d failed: %s", chapter_n, e)
        return None


def list_chronicles() -> list[dict[str, Any]]:
    _CHRONICLE_DIR.mkdir(parents=True, exist_ok=True)
    result = []
    for p in sorted(_CHRONICLE_DIR.glob("chapter_*.json"), reverse=True):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            result.append({
                "chapter": data.get("chapter", 0),
                "chapter_label": data.get("chapter_label", ""),
                "virtual_date": data.get("virtual_date", ""),
                "title": data.get("title", ""),
                "generated_at": data.get("generated_at", ""),
                "total_tasks": data.get("summary", {}).get("total_tasks", 0),
                "preview": (data.get("text", "") or "")[:100],
            })
        except Exception:
            result.append({
                "chapter": 0, "chapter_label": "", "virtual_date": p.stem,
                "title": "", "generated_at": "", "total_tasks": 0, "preview": "",
            })
    return result


async def generate_chronicle(
    *,
    period_hours: float = 5.0,
    agent_name_map: dict[str, str] | None = None,
    broadcast_fn=None,
) -> dict[str, Any]:
    from llm_client import chronicle_completion

    chapter_n = _next_chapter()
    chapter_label = _chapter_label(chapter_n)
    start_ts, end_ts = _period_bounds(int(period_hours))
    period_label = _report_period_label(start_ts, end_ts)
    summary = _build_chapter_summary(chapter_n, start_ts, end_ts, agent_name_map)

    logger.info(
        "chronicle: generating %s (%s) tasks=%d window=%.1fh",
        chapter_label, period_label, summary["total_tasks"], period_hours,
    )

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _build_chapter_prompt(chapter_n, period_label, summary)},
    ]
    try:
        result = await chronicle_completion(messages, temperature=0.7, max_tokens=16000)
        raw = result.get("raw", "")
        text = _strip_think_blocks(raw)
        logger.info("chronicle: %s text generated, len=%d (raw=%d)", chapter_label, len(text), len(raw))
    except Exception as e:
        logger.error("chronicle: LLM call failed: %s", e)
        text = f"（{chapter_label} 运行日报生成失败：{e}）"

    chapter_title = ""
    if text and not text.startswith("（"):
        try:
            title_messages = [
                {"role": "system", "content": _TITLE_SYSTEM_PROMPT},
                {"role": "user", "content": f"运行日报正文：\n{text[:400]}"},
            ]
            title_result = await chronicle_completion(title_messages, temperature=0.5, max_tokens=4096)
            raw_title = _strip_think_blocks(title_result.get("raw", ""))
            title_lines = raw_title.splitlines()
            chapter_title = title_lines[0].strip().strip('"').strip("'")
            logger.info("chronicle: %s title: %s", chapter_label, chapter_title)
        except Exception as e:
            logger.warning("chronicle: title generation failed: %s", e)

    record = {
        "chapter": chapter_n,
        "chapter_label": chapter_label,
        "virtual_date": period_label,
        "generated_at": datetime.now(_display_tz()).isoformat(),
        "title": chapter_title,
        "text": text,
        "summary": {
            "total_tasks": summary["total_tasks"],
            "total_completed": summary["total_completed"],
            "total_failed": summary["total_failed"],
        },
        "agent_stats": summary["agent_stats"],
    }

    _CHRONICLE_DIR.mkdir(parents=True, exist_ok=True)
    chronicle_path(chapter_n).write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("chronicle: saved %s → chapter_%04d.json (%d chars)", chapter_label, chapter_n, len(text))

    if broadcast_fn is not None:
        try:
            await broadcast_fn({
                "type": "chronicle_published",
                "chapter": chapter_n,
                "chapter_label": chapter_label,
                "virtual_date": period_label,
                "date": period_label,
                "title": chapter_title,
                "preview": text[:200],
            })
        except Exception as e:
            logger.warning("chronicle: broadcast failed: %s", e)

    return record


async def regenerate_chronicle(
    chapter_n: int,
    *,
    period_hours: float = 24.0,
    agent_name_map: dict[str, str] | None = None,
    broadcast_fn=None,
) -> dict[str, Any] | None:
    from llm_client import chronicle_completion

    data = load_chronicle(chapter_n)
    if data is None:
        return None

    chapter_label = data.get("chapter_label") or _chapter_label(chapter_n)
    start_ts, end_ts = _period_bounds(int(period_hours))
    period_label = _report_period_label(start_ts, end_ts)
    summary = _build_chapter_summary(chapter_n, start_ts, end_ts, agent_name_map)

    logger.info(
        "chronicle: regenerate %s (%s) tasks=%d window=%.1fh",
        chapter_label, period_label, summary["total_tasks"], period_hours,
    )

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _build_chapter_prompt(chapter_n, period_label, summary)},
    ]
    try:
        result = await chronicle_completion(messages, temperature=0.7, max_tokens=16000)
        raw = result.get("raw", "")
        text = _strip_think_blocks(raw)
        logger.info("chronicle: regenerate %s text len=%d", chapter_label, len(text))
    except Exception as e:
        logger.error("chronicle: regenerate LLM failed: %s", e)
        text = f"（{chapter_label} 运行日报重新生成失败：{e}）"

    chapter_title = ""
    if text and not text.startswith("（"):
        try:
            title_messages = [
                {"role": "system", "content": _TITLE_SYSTEM_PROMPT},
                {"role": "user", "content": f"运行日报正文：\n{text[:400]}"},
            ]
            title_result = await chronicle_completion(title_messages, temperature=0.5, max_tokens=4096)
            raw_title = _strip_think_blocks(title_result.get("raw", ""))
            title_lines = raw_title.splitlines()
            chapter_title = title_lines[0].strip().strip('"').strip("'")
        except Exception as e:
            logger.warning("chronicle: regenerate title failed: %s", e)

    record = {
        **data,
        "virtual_date": period_label,
        "generated_at": datetime.now(_display_tz()).isoformat(),
        "title": chapter_title,
        "text": text,
        "summary": {
            "total_tasks": summary["total_tasks"],
            "total_completed": summary["total_completed"],
            "total_failed": summary["total_failed"],
        },
        "agent_stats": summary["agent_stats"],
    }

    _CHRONICLE_DIR.mkdir(parents=True, exist_ok=True)
    chronicle_path(chapter_n).write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("chronicle: regenerated %s tasks=%d", chapter_label, summary["total_tasks"])

    if broadcast_fn is not None:
        try:
            await broadcast_fn({
                "type": "chronicle_published",
                "chapter": chapter_n,
                "chapter_label": chapter_label,
                "virtual_date": period_label,
                "date": period_label,
                "title": chapter_title,
                "preview": text[:200],
            })
        except Exception as e:
            logger.warning("chronicle: broadcast failed: %s", e)

    return record
