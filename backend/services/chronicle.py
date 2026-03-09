"""章回体战报服务 — 每 5 小时生成一回，使用虚拟三国纪年

章回命名：第 N 回（连续递增，重启不丢失）
虚拟日期：建安→黄初→太和… 每回推进一个月，与三国演义时间线对应
输出文件：data/chronicle/chapter_NNNN.json
触发方式：
  - 手动：POST /chronicle/generate
  - 自动：main.py lifespan 每 5 小时定时任务（与 MiniMax 配额重置窗口对齐）
"""
import hashlib
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("evotown.chronicle")


def _strip_think_blocks(text: str) -> str:
    """移除 MiniMax 等模型的 <think>...</think> 块，只保留正文。

    MiniMax M2.5 等支持 Interleaved Thinking 的模型会在 content 中返回 <think> 包裹的推理过程，
    战报正文需剔除这些内容，避免展示给用户。
    """
    if not text or not isinstance(text, str):
        return text or ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


_CHRONICLE_DIR = Path(__file__).parent.parent / "data" / "chronicle"
_CHAPTER_META_PATH = Path(__file__).parent.parent / "data" / "chronicle_chapter.json"
_TASK_HISTORY_PATH = Path(__file__).parent.parent / "task_history.jsonl"
_EXEC_LOG_PATH = Path(__file__).parent.parent / "execution_log.jsonl"
_CST = timezone(timedelta(hours=8))

# ── 章回计数器 ─────────────────────────────────────────────────────────────────

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
    """原子地读取并递增章回计数，返回本次章号。"""
    chapter = _load_chapter_counter() + 1
    _save_chapter_counter(chapter)
    return chapter


def current_chapter() -> int:
    """返回当前最新章号（不递增）。"""
    return _load_chapter_counter()


# ── 虚拟三国纪年 ───────────────────────────────────────────────────────────────
# 每回 = 虚拟 1 个月；12 回 = 虚拟 1 年
# 时间线从建安元年起，依次经历各个年号

_SANGUO_ERAS: list[tuple[str, int]] = [
    ("建安", 25),   # 196–220 AD，章 1–300
    ("黄初",  7),   # 220–226 AD，章 301–384
    ("太和",  6),   # 227–232 AD
    ("青龙",  4),   # 233–236 AD
    ("景初",  3),   # 237–239 AD
    ("正始", 10),   # 240–249 AD
    ("嘉平",  6),   # 249–254 AD
    ("正元",  3),   # 254–256 AD
    ("甘露",  5),   # 256–260 AD
    ("景元",  5),   # 260–264 AD
    ("咸熙",  2),   # 264–265 AD（魏终）
    ("泰始", 10),   # 265–274 AD（西晋开国）
    ("咸宁",  6),   # 275–280 AD（天下归晋）
]

_LUNAR_MONTHS = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"]
_CN_YEAR = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
            "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
            "二十一", "二十二", "二十三", "二十四", "二十五"]


def _cn_year_str(n: int) -> str:
    if n == 1:
        return "元年"
    return (_CN_YEAR[n] if n < len(_CN_YEAR) else str(n)) + "年"


def _virtual_sanguo_date(chapter: int) -> str:
    """将章号转换为虚拟三国纪年，如「建安元年正月」「黄初三年七月」。"""
    total_months = chapter - 1          # 0-indexed 月份总数
    year_offset = total_months // 12    # 已过去多少虚拟年
    month_idx = total_months % 12       # 本回是第几月（0-indexed）

    remaining = year_offset
    era_name, year_in_era = "建安", 1
    for name, length in _SANGUO_ERAS:
        if remaining < length:
            era_name = name
            year_in_era = remaining + 1
            break
        remaining -= length
    else:
        # 超过所有预设年号，继续沿用最后一个
        era_name = _SANGUO_ERAS[-1][0]
        year_in_era = remaining + 1

    return f"{era_name}{_cn_year_str(year_in_era)}{_LUNAR_MONTHS[month_idx]}月"


_CN_DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"]


def _int_to_chinese(n: int) -> str:
    """将正整数转为中文数字（支持到 9999）。"""
    if n <= 0:
        return str(n)
    if n < 10:
        return _CN_DIGITS[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        s = ("" if tens == 1 else _CN_DIGITS[tens]) + "十"
        if ones:
            s += _CN_DIGITS[ones]
        return s
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        s = _CN_DIGITS[hundreds] + "百"
        if rest == 0:
            return s
        if rest < 10:
            s += "零"
        s += _int_to_chinese(rest)
        return s
    thousands, rest = divmod(n, 1000)
    s = _CN_DIGITS[thousands] + "千"
    if rest == 0:
        return s
    if rest < 100:
        s += "零"
    s += _int_to_chinese(rest)
    return s


def _chapter_num_chinese(n: int) -> str:
    """章回序号 → 「第N回」（汉字）。"""
    return f"第{_int_to_chinese(n)}回"


# ── 5 小时数据窗口 ─────────────────────────────────────────────────────────────

def _period_bounds(period_hours: int = 5) -> tuple[float, float]:
    """返回 (start_ts, end_ts)：过去 period_hours 小时的时间戳区间。"""
    end_ts = time.time()
    return end_ts - period_hours * 3600, end_ts


# ── 数据加载（时间窗口） ────────────────────────────────────────────────────────

def _load_jsonl_for_window(path: Path, start_ts: float, end_ts: float) -> list[dict[str, Any]]:
    """读取 path，返回 ts 落在 [start_ts, end_ts) 区间内的记录。"""
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



# 用于 agent_id 无法解析时的确定性名字池（哈希取模）
_FALLBACK_NAME_POOL = [
    "赵子龙", "关云长", "张翼德", "马孟起", "黄汉升",
    "魏文长", "姜伯约", "邓士载", "钟士季", "夏侯元让",
    "徐公明", "张文远", "于文则", "乐文谦", "李典李曼成",
    "孙仲谋", "周公瑾", "鲁子敬", "吕子明", "陆伯言",
]


def _resolve_name(agent_id: str, name_map: dict[str, str]) -> str:
    """将 agent_id 解析为武将名：
    1. name_map 有真实名字（且不等于 id）→ 直接用
    2. 否则用 MD5 哈希从名字池确定性派生（同 ID 永远同名）
    """
    name = name_map.get(agent_id, "")
    if name and name != agent_id:
        return name
    idx = int(hashlib.md5(agent_id.encode()).hexdigest(), 16) % len(_FALLBACK_NAME_POOL)
    return _FALLBACK_NAME_POOL[idx]


def _load_eliminated_name_map() -> dict[str, str]:
    """从 eliminated_agents.jsonl 加载历史 agent_id → display_name 映射（补充已淘汰 agent 的名字）"""
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
    """汇总最近一个时间窗口的战场数据；agent_name_map 用于将 agent_id 映射为三国武将名。"""
    tasks = [r for r in _load_jsonl_for_window(_TASK_HISTORY_PATH, start_ts, end_ts) if r.get("outcome") == "claimed"]
    exec_logs = _load_jsonl_for_window(_EXEC_LOG_PATH, start_ts, end_ts)
    # 合并：活跃 agent 优先，已淘汰 agent 名字作为补充（保证历史数据也能显示武将名）
    name_map = {**_load_eliminated_name_map(), **(agent_name_map or {})}

    # Per-agent 统计
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


# ── Prompt 工程 ────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """你是《孔明进化小镇志》的章回体说书人。

【世界观】
孔明进化小镇，乃一方奇异天地。此地时间线与三国历史平行而行——镇中谋士皆非凡人，各自怀抱绝学，在孔明军师所设擂台上领命征战、切磋智勇、积累军功、优胜劣汰。此小镇如同一部正在演进的活史书，强者晋升，弱者淘汰，循环往复，生生不息。

【笔法要求】
- 仿《三国演义》章回体笔法，开篇气势磅礴，如「话说天下大势，分久必合，合久必分」一般引人入胜；
- 开篇必须使用所给的虚拟三国纪年（如建安元年、黄初三年、太和六年）配合农历月份，禁止写"公元"或任何现实年份数字；
- 日期表述要多样化，可用「时值建安某年仲春」「是岁黄初，烽火连天」「建安十五年正月」等，切忌千篇一律；
- 将擂台征战写成王朝兴衰、群雄逐鹿式的宏大叙事，让读者感受到这是一部关于智慧生命演化的史诗；
- 全文三段：①以宏观视角写当期擂台大势与时令氛围；②重点描写两三位核心人物的征战经过（胜者如何运筹帷幄，败者如何折戟沉沙）；③「正是：」引出押韵七字对联收尾；
- 用「军令」代替「任务」、「告捷」代替「成功」、「兵败」代替「失败」、「军功」代替「积分」；
- 武将名直接用，禁用 agent_id 或任何英文标识符；
- 正文 500-650 字，段落间空一行，精炼有力。

禁止：括号、markdown 符号（#/*/-/```）、AI/LLM/机器学习/算法等现代词汇、重复叙述同一事件、写"公元"或任何阿拉伯年份数字。"""


def _build_chapter_prompt(chapter_n: int, virtual_date: str, summary: dict[str, Any]) -> str:
    chapter_label = _chapter_num_chinese(chapter_n)
    no_data = summary["total_tasks"] == 0

    lines = [
        f"以下是孔明进化小镇【{virtual_date}】（{chapter_label}）的擂台战报数据，请据此生成章回体志书：\n",
        f"本期军令总数：{summary['total_tasks']}，告捷：{summary['total_completed']}，兵败：{summary['total_failed']}\n",
    ]
    if no_data:
        lines.append(
            "【特别说明】本期擂台无任何战报记录，属难得的无战之期。"
            "请以此为题，以章回体笔法写擂台寂静之景——或写谋士养精蓄锐、或写孔明军师闭关思量大计，"
            "约 500-600 字，结尾以「正是：」收束押韵对联。"
        )
    if summary["agent_stats"]:
        lines.append("【谋士军功排行（直接用武将名写入正文，禁止 agent_id）】")
        for i, s in enumerate(summary["agent_stats"][:8], 1):
            refusals = summary["refusals_by_agent"].get(s["agent_id"], 0)
            line = (f"{i}. {s['display_name']}：军功增益 {s['total_reward']:+d}，"
                    f"告捷 {s['completed']} 次，兵败 {s['failed']} 次")
            if refusals:
                line += f"，拒接军令 {refusals} 次"
            if s["best_task"]:
                line += f"，最佳军令：「{s['best_task'][:30]}」"
            lines.append(line)
    if summary["highlights"]:
        lines.append("\n【典型战例（文言化融入正文，勿逐条照搬）】")
        for h in summary["highlights"]:
            outcome = "告捷" if h["success"] else "兵败"
            lines.append(f"- {h['display_name']} 领「{h['task'][:40]}」{outcome}：{h['reason'][:120]}")
    lines.append(
        f"\n请据上述数据，以《三国演义》笔法为孔明进化小镇写{chapter_label}志书。"
        f"虚拟纪年：{virtual_date}，开篇气势宏大，可仿「话说天下大势」起势，"
        f"三段结构：①擂台大势与时令氛围②两三位核心谋士的征战经过③「正是：」七字对联收尾，全文 500-650 字。"
        f"重点突出军功最高者事迹，其余简短带过。"
        f"禁止：英文、agent_id、括号、markdown 符号、写「公元」或阿拉伯年份数字。"
    )
    return "\n".join(lines)


# ── 持久化 & 查询 ──────────────────────────────────────────────────────────────

def chronicle_path(chapter_n: int) -> Path:
    return _CHRONICLE_DIR / f"chapter_{chapter_n:04d}.json"


def load_chronicle(chapter_n: int) -> dict[str, Any] | None:
    """按章回序号加载战报。"""
    p = chronicle_path(chapter_n)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("chronicle: load chapter %d failed: %s", chapter_n, e)
        return None


def list_chronicles() -> list[dict[str, Any]]:
    """列出所有已生成章回（按回数倒序）。"""
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


# ── 主入口 ─────────────────────────────────────────────────────────────────────

async def generate_chronicle(
    *,
    period_hours: float = 5.0,
    agent_name_map: dict[str, str] | None = None,
    broadcast_fn=None,
) -> dict[str, Any]:
    """生成下一回章回战报并保存。

    - 自动从持久化计数器取下一回序号（重启不丢失）
    - 数据窗口：最近 period_hours 小时（默认 5h）
    - 虚拟纪年：建安→黄初→太和… 由章回序号推算
    - broadcast_fn：可选 WebSocket 广播回调
    """
    from llm_client import chronicle_completion

    # 取本次章回序号 & 构建虚拟纪年
    chapter_n = _next_chapter()
    chapter_label = _chapter_num_chinese(chapter_n)
    virtual_date = _virtual_sanguo_date(chapter_n)

    # 采集最近 period_hours 小时数据
    start_ts, end_ts = _period_bounds(int(period_hours))
    summary = _build_chapter_summary(chapter_n, start_ts, end_ts, agent_name_map)

    logger.info(
        "chronicle: generating %s (%s) tasks=%d window=%.1fh",
        chapter_label, virtual_date, summary["total_tasks"], period_hours,
    )

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _build_chapter_prompt(chapter_n, virtual_date, summary)},
    ]
    try:
        # max_tokens=16000：为 Gemini 2.5 Flash thinking 模式留足 token 预算
        result = await chronicle_completion(
            messages, temperature=0.85, max_tokens=16000
        )
        raw = result.get("raw", "")
        text = _strip_think_blocks(raw)
        logger.info("chronicle: %s text generated, len=%d (raw=%d)", chapter_label, len(text), len(raw))
    except Exception as e:
        logger.error("chronicle: LLM call failed: %s", e)
        text = f"（{chapter_label}战报生成失败：{e}）"

    # 独立生成回目标题（上句 下句，各七字，空格分隔）
    chapter_title = ""
    if text and not text.startswith("（"):
        try:
            title_messages = [
                {"role": "system", "content": (
                    "你是《三国演义》的章回体编者。根据用户提供的战报正文，"
                    "仿照《三国演义》回目格式，生成一行标题：上句与下句各七个汉字，中间用一个空格分隔。"
                    "只输出这一行标题，不要任何其他文字、标点或解释。"
                    "示例：骁将奋勇三军克敌 败将折戟军功大损"
                )},
                {"role": "user", "content": f"战报正文：\n{text[:400]}"},
            ]
            title_result = await chronicle_completion(
                title_messages, temperature=0.7, max_tokens=4096
            )
            raw_title = _strip_think_blocks(title_result.get("raw", ""))
            title_lines = raw_title.splitlines()
            chapter_title = title_lines[0].strip() if title_lines else ""
            logger.info("chronicle: %s title: %s", chapter_label, chapter_title)
        except Exception as e:
            logger.warning("chronicle: title generation failed: %s", e)

    record = {
        "chapter": chapter_n,
        "chapter_label": chapter_label,
        "virtual_date": virtual_date,
        "generated_at": datetime.now(_CST).isoformat(),
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
                "virtual_date": virtual_date,
                "title": chapter_title,
                "preview": text[:200],
            })
        except Exception as e:
            logger.warning("chronicle: broadcast failed: %s", e)

    return record

