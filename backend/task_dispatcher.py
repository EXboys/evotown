"""Evotown 任务分发器 — 任务板模式：任务上屏、全员可见、先到先得

职责：
  1. 用 LLM 根据 agent 能力/历史动态生成任务
  2. 任务加入任务板 → 广播 task_available（所有人可见）
  3. 向所有空闲 agent 并发发送预览，先 ACCEPT 者得
  4. 全部拒绝则任务保留在板，60 分钟后自动消失
  5. 多个任务可并存

多样性优化（v2）：
  - 主题轮换：20+ 领域加权随机（用少的优先），防止同类任务扎堆
  - 历史去重：从 task_history.jsonl 加载已完成/已尝试任务，跨轮避免重复
  - n-gram 语义过滤：字符 bigram Jaccard 相似度 ≥ 0.5 视为重复
  - 种子扩展：30 条覆盖更多领域，用完不重放
  - 进化感知：refill 时注入 agent 当前技能/规则摘要，生成"边界任务"
  - 动态难度：根据近期成功率自动调整 easy/medium/hard 比例
"""
import asyncio
import logging
import os
import random
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from infra.execution_log import count_refusals_by_task
from infra.task_history import load_task_history
from llm_client import dispatcher_completion

logger = logging.getLogger("evotown.dispatcher")

# (task_text, difficulty)
TaskItem = tuple[str, str]

# 任务板上无人认领时，60 分钟后自动消失
TASK_BOARD_EXPIRY_SEC = 60 * 60

# 任务板与任务 NPC 最多同时存在数量
MAX_AVAILABLE_TASKS = 3

# 派发停滞阈值：若连续 N 秒无任务被成功认领，触发全面复盘并生成新任务计划
STUCK_THRESHOLD_SEC = 300  # 5 分钟，可通过 EVOTOWN_STUCK_THRESHOLD_SEC 覆盖

# 三档拒绝机制：
#   < REFUSAL_THRESHOLD_CHALLENGE  → 常规任务（正常预览，agent 可拒绝）
#   [CHALLENGE, MANDATORY)         → 挑战任务（25% 概率优先上板，agent 仍可拒绝）
#   >= REFUSAL_MANDATORY_THRESHOLD → 强制任务（跳过预览，直接注入，agent 无法拒绝，直到完成）
REFUSAL_THRESHOLD_CHALLENGE = 2
REFUSAL_MANDATORY_THRESHOLD = 8   # 原 MAX_REFUSAL_BEFORE_DROP，现改为触发强制而非丢弃
# 挑战任务选取概率：约 25% 时选高拒绝任务，给进化后的 agent 尝试机会
CHALLENGE_TASK_PICK_RATIO = 0.25

# n-gram 相似度阈值：超过此值认为是重复任务（0~1，越小越严格）
NGRAM_SIMILARITY_THRESHOLD = 0.5
# 从历史记录中加载多少条已完成任务用于去重
HISTORY_DEDUP_LIMIT = 300

TASK_GEN_PROMPT = """\
汝乃三国·孔明传之军令官，专为麾下谋士发布军令，驱动其习得奇谋、立下战功。
可用工具：搜索、文件操作、代码执行、计算、文本处理。禁用实时天气 API。

军令要义（进化引擎以 total_tools≥2 计入有效晋阶）：
- easy（传令）：至少2工具，如 list_dir+read_file、search+calc
- medium（会战）：2步以上，搜索+计算/代码 或 多源比较
- hard（决战）：多步推理、组合多工具、需归纳规律

难度分配军令：{difficulty_hint}

制令规矩：
- 每条军令 4~20 字，仅用中文，结果可验证。
- **要害**：每令必须调用 2+ 工具。不可仅凭记忆作答（如"中国首都"、"3的平方"）。
- 优先：搜索+计算、搜索+代码、文件+代码；多项对比排序；可重试演练之令。
- 禁出天气军令（无天气 API）。
- **勿与既有军令雷同**（见用户消息中的历史军令）。
- 生成恰好 {count} 条军令，每令主题各异。

{evolution_context_section}

以 JSON 回令：{{"tasks": [{{"text": "军令简述", "difficulty": "easy|medium|hard"}}, ...]}}
"""

# 任务主题：20+ 领域，覆盖更广的能力域，引导进化多样性
TASK_THEMES = [
    # 数据与计算
    "搜索+计算：查数据后做运算",
    "单位换算、日期计算、数值验证",
    "统计与概率：计算频率/期望/方差",
    "数学规律归纳：找序列规则并预测",
    # 编程与代码
    "搜索+代码：查文档后写示例",
    "算法实现：排序/搜索/动态规划",
    "代码调试：找出并修正逻辑错误",
    "API/库文档查询并写调用示例",
    # 信息检索与比较
    "多源比较、排序、筛选",
    "跨领域对比：科技/地理/历史数据",
    "多步验证、交叉校验结果",
    "时间线整理：事件排序与关联",
    # 文件与系统操作
    "文件操作+统计/分析",
    "文本处理：字数统计/格式转换/提取",
    "目录扫描+内容聚合",
    # 逻辑与推理
    "逻辑推理、归纳规律",
    "因果分析：给定前提推导结论",
    "条件筛选：多条件组合过滤",
    # 知识综合
    "百科知识+计算：查询+运算结合",
    "地理+数学：地图数据与几何计算",
    "科学+编程：物理/化学公式编程验证",
    "语言处理：词频统计/句子分析",
    # 三国·军令专项（孔明传主题）
    "三国地理：查州郡城池距离/面积并运算",
    "兵力推演：搜索史料兵力数据并对比计算",
    "谋士策略：查历史典故并推理最优路线",
    "粮草计算：搜索行军距离/速度推算补给周期",
    "战役复盘：查史书数据并用代码模拟胜负",
    "名将排名：多维度搜索三国武将数据并排序",
    "外交连横：搜索各国/势力数据并比较实力",
]

# 种子任务：30 条，覆盖更多领域，LLM 失败时 fallback 使用
SEED_TASKS: list[TaskItem] = [
    # 搜索+计算
    ("比较俄罗斯和加拿大面积", "medium"),
    ("搜索2024春节日期并算距今天数", "medium"),
    ("查询月球直径并计算其表面积", "medium"),
    ("搜索光速并算1光年距离(km)", "medium"),
    # 编程
    ("搜索Python最新版本并写Hello World", "medium"),
    ("用代码求1到50的素数个数", "medium"),
    ("计算2^10并验证位数", "medium"),
    ("计算10!并验证结果的位数", "hard"),
    ("用代码实现冒泡排序并测试", "hard"),
    ("搜索Fibonacci数列并用代码生成前20项", "medium"),
    # 多源比较
    ("比较俄加中三国面积并排序", "hard"),
    ("找出3个以B开头的国家首都", "medium"),
    ("比较Python和JavaScript的发布年份", "easy"),
    ("查询三大洋面积并按从大到小排序", "medium"),
    # 文件操作
    ("读取当前目录txt文件并统计总行数", "hard"),
    ("列出当前目录所有文件并统计数量", "easy"),
    ("搜索并保存一段文本到文件再读回", "medium"),
    # 逻辑推理
    ("搜索某REST API文档并写调用示例", "hard"),
    ("查询世界前5大城市人口并求平均", "medium"),
    ("搜索并验证：哥德巴赫猜想举3个例子", "hard"),
    # 单位换算
    ("将100英里转换为公里并验证", "easy"),
    ("计算1英亩等于多少平方米", "easy"),
    ("搜索1海里定义并换算为米", "easy"),
    # 时间与历史
    ("搜索互联网发明年份并算距今多少年", "easy"),
    ("查询阿波罗11号登月日期并计算纪念日", "medium"),
    ("搜索三次工业革命时间并计算间隔", "medium"),
    # 文本处理
    ("统计'hello world'各字母出现频率", "easy"),
    ("用代码反转字符串并验证回文", "easy"),
    # 综合难题
    ("搜索前10大国GDP并找出中位数", "hard"),
    ("查询并验证欧拉公式 e^(iπ)+1=0", "hard"),
    # 三国·军令专项
    ("搜索赤壁之战兵力并计算双方比例", "medium"),
    ("查询三国鼎立时期各国面积并排序", "medium"),
    ("搜索诸葛亮北伐次数并统计成败", "easy"),
    ("用代码模拟官渡之战双方消耗对比", "hard"),
    ("搜索三国时期主要战役并按年排序", "medium"),
    ("查蜀道距离并计算行军天数", "medium"),
    ("搜索三国名将寿命并计算平均年龄", "medium"),
    ("比较曹魏/蜀汉/东吴疆域面积", "hard"),
]


# 任务板条目：task_id -> {task, difficulty, created_at}
_AvailableTask = dict[str, Any]


def _bigram_set(text: str) -> set[str]:
    """生成字符级 bigram 集合，用于 Jaccard 相似度计算。"""
    if len(text) < 2:
        return {text}
    return {text[i:i+2] for i in range(len(text) - 1)}


def _jaccard_similarity(a: str, b: str) -> float:
    """计算两个字符串的 bigram Jaccard 相似度（0~1）。"""
    sa, sb = _bigram_set(a), _bigram_set(b)
    if not sa and not sb:
        return 1.0
    intersection = len(sa & sb)
    union = len(sa | sb)
    return intersection / union if union > 0 else 0.0


@dataclass
class TaskDispatcher:
    """任务分发器 — 任务板模式（v2：多样性优化）"""
    _task_pool: list[TaskItem] = field(default_factory=lambda: list(SEED_TASKS))
    _available_tasks: dict[str, _AvailableTask] = field(default_factory=dict)  # task_id -> {task, difficulty, created_at}
    _task_id_counter: int = field(default=0)
    _running: bool = False
    _stop_event: asyncio.Event | None = field(default=None, repr=False)
    _interval: float = 30.0  # 分发检查间隔（秒）
    _min_pool_size: int = 5
    _broadcast_assign_fn: Callable[[str, str, str], Awaitable[str | None]] | None = None
    _get_idle_agents: Callable[[], list[str]] | None = None
    _get_agent_difficulty_counts: Callable[[str], dict[str, int]] | None = None
    _on_task_available: Callable[[str, str, str, str], Awaitable[None]] | None = None
    _on_task_taken: Callable[[str, str, str], Awaitable[None]] | None = None
    _on_task_expired: Callable[[str, str], Awaitable[None]] | None = None
    # 多样性优化新增字段
    _theme_use_counts: dict[str, int] = field(default_factory=dict)   # 主题使用次数，低使用率优先
    _used_seed_texts: set[str] = field(default_factory=set)            # 已用过的种子任务，不重复放回
    _evolution_context: str = field(default="")                        # agent 进化状态摘要（供 LLM 生成边界任务）
    _recent_outcomes: list[bool] = field(default_factory=list)         # 最近任务成功/失败记录（动态难度）
    _mandatory_task_texts: set[str] = field(default_factory=set)       # 拒绝次数 >= REFUSAL_MANDATORY_THRESHOLD 的强制任务
    _last_successful_claim_at: float = field(default=0.0)              # 上次任务被成功认领的时间戳（用于 5 分钟停滞检测）
    _stuck_recovery_mode: bool = field(default=False)                  # 是否处于「全面复盘」后的恢复模式（偏 easy）

    def configure(
        self,
        broadcast_assign_fn: Callable[[str, str, str], Awaitable[str | None]],
        get_idle_agents: Callable[[], list[str]],
        get_agent_difficulty_counts: Callable[[str], dict[str, int]] | None = None,
        on_task_available: Callable[[str, str, str, str], Awaitable[None]] | None = None,
        on_task_taken: Callable[[str, str, str], Awaitable[None]] | None = None,
        on_task_expired: Callable[[str, str], Awaitable[None]] | None = None,
        interval: float = 30.0,
    ) -> None:
        self._broadcast_assign_fn = broadcast_assign_fn
        self._get_idle_agents = get_idle_agents
        self._get_agent_difficulty_counts = get_agent_difficulty_counts
        self._on_task_available = on_task_available
        self._on_task_taken = on_task_taken
        self._on_task_expired = on_task_expired
        self._interval = interval

    def set_evolution_context(self, agent_summaries: list[dict[str, Any]]) -> None:
        """注入 agent 进化状态摘要，供任务生成时生成"边界任务"（超出当前能力一步）。
        agent_summaries: [{"name": str, "rule_count": int, "skill_count": int, "success_rate": float}, ...]
        """
        if not agent_summaries:
            self._evolution_context = ""
            return
        lines = []
        for a in agent_summaries:
            name = a.get("name", "?")
            rules = a.get("rule_count", 0)
            skills = a.get("skill_count", 0)
            rate = a.get("success_rate", 0.5)
            lines.append(f"- {name}: {rules} rules, {skills} skills, success_rate={rate:.0%}")
        self._evolution_context = "\n".join(lines)
        logger.debug("Evolution context updated (%d agents)", len(agent_summaries))

    def record_outcome(self, success: bool) -> None:
        """记录任务成功/失败，用于动态难度调整（保留最近 30 条）。"""
        self._recent_outcomes.append(success)
        if len(self._recent_outcomes) > 30:
            self._recent_outcomes = self._recent_outcomes[-30:]

    def _recent_success_rate(self) -> float:
        """近期成功率（无历史时返回 0.6 作为中性值）。"""
        if not self._recent_outcomes:
            return 0.6
        return sum(self._recent_outcomes) / len(self._recent_outcomes)

    def _get_stuck_threshold_sec(self) -> float:
        """派发停滞阈值（秒），可从 EVOTOWN_STUCK_THRESHOLD_SEC 覆盖。"""
        val = os.environ.get("EVOTOWN_STUCK_THRESHOLD_SEC", str(int(STUCK_THRESHOLD_SEC)))
        try:
            return float(val)
        except (ValueError, TypeError):
            return float(STUCK_THRESHOLD_SEC)

    def _difficulty_hint(self) -> str:
        """根据近期成功率和恢复模式，循序渐进建议难度，避免陡然过难导致全员拒绝。

        原则：任务目的是触发进化，需适度挑战；但难度应循序推进，不可陡然过难。
        """
        if self._stuck_recovery_mode:
            return "全部 easy，无 medium/hard（派发停滞后全面复盘，先恢复信心）"
        rate = self._recent_success_rate()
        if rate >= 0.8:
            return "偏多 hard（成功率高，需要更难任务推动进化）"
        elif rate <= 0.35:
            return "全部或绝大部分 easy，无 hard（成功率偏低，需简单任务恢复）"
        elif rate <= 0.5:
            return "偏多 easy，少量 medium，无 hard（循序渐进）"
        elif rate <= 0.7:
            return "均衡 easy/medium，少量 hard（3:5:2）"
        else:
            return "均衡 easy/medium/hard（3:5:2）"

    def _pick_theme(self) -> str:
        """加权随机选主题：使用次数少的主题优先，防止主题扎堆。"""
        if not self._theme_use_counts:
            # 初始化所有主题计数为 0
            for t in TASK_THEMES:
                self._theme_use_counts[t] = 0
        # 权重 = 1 / (使用次数 + 1)，使用越少权重越高
        weights = [1.0 / (self._theme_use_counts.get(t, 0) + 1) for t in TASK_THEMES]
        chosen = random.choices(TASK_THEMES, weights=weights, k=1)[0]
        self._theme_use_counts[chosen] = self._theme_use_counts.get(chosen, 0) + 1
        return chosen

    def _load_history_task_texts(self) -> set[str]:
        """从 task_history.jsonl 加载最近已完成/已尝试的任务文本，用于跨轮去重。"""
        try:
            records = load_task_history(limit=HISTORY_DEDUP_LIMIT)
            return {(r.get("task") or "").strip() for r in records if r.get("task")}
        except Exception as e:
            logger.debug("Could not load history for dedup: %s", e)
            return set()

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._last_successful_claim_at = time.time()  # 启动时视为「刚有认领」，避免启动即触发停滞
        if self._stop_event is None:
            self._stop_event = asyncio.Event()
        self._stop_event.clear()
        logger.info("Task dispatcher started (interval=%.1fs, stuck_threshold=%.0fs)", self._interval, self._get_stuck_threshold_sec())
        asyncio.create_task(self._loop())

    async def stop(self) -> None:
        """停止任务分发。仅停止向任务板添加新任务，已接任务的 agent 会继续执行直至完成。"""
        self._running = False
        if self._stop_event is not None:
            self._stop_event.set()
        logger.info("Task dispatcher stopped (in-progress tasks continue)")

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._tick()
            except Exception as e:
                logger.error("Dispatcher tick error: %s", e)
            if not self._running:
                break
            # 可中断的 sleep：stop() 调用 set() 后立即唤醒，否则等待 interval
            if self._stop_event is not None:
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=self._interval)
                except asyncio.TimeoutError:
                    pass
            else:
                await asyncio.sleep(self._interval)

    def _next_task_id(self) -> str:
        self._task_id_counter += 1
        return f"t_{self._task_id_counter}"

    def _trigger_stuck_recovery(self) -> None:
        """派发停滞 5 分钟后全面复盘：清空任务池，进入恢复模式，下次 refill 只生成 easy 任务。"""
        self._task_pool.clear()
        self._mandatory_task_texts.clear()
        self._stuck_recovery_mode = True
        logger.warning(
            "[dispatcher] 派发停滞 %.0f 分钟，全面复盘：清空任务池，生成全新 easy 任务计划",
            self._get_stuck_threshold_sec() / 60,
        )

    def return_task_to_pool(self, task_text: str, difficulty: str) -> None:
        """将任务放回任务池。三档处理：
        - 拒绝次数 < REFUSAL_THRESHOLD_CHALLENGE：常规任务，正常排队
        - 拒绝次数 [CHALLENGE, MANDATORY)：挑战任务，_pick_task_for_board 会优先选取
        - 拒绝次数 >= REFUSAL_MANDATORY_THRESHOLD：升级为强制任务，下次上板时跳过预览直接注入
          （任务永不丢弃，直到有 agent 成功完成为止）
        """
        key = (task_text or "").strip()
        refusal_counts = count_refusals_by_task()
        count = refusal_counts.get(key, 0)
        if count >= REFUSAL_MANDATORY_THRESHOLD:
            self._mandatory_task_texts.add(key)
            logger.info(
                "Task upgraded to MANDATORY (refused %d times): %s",
                count, task_text[:50],
            )
        self._task_pool.append((task_text, difficulty))
        logger.debug("Returned task to pool: [%s] %s (refused %d times)", difficulty, task_text[:40], count)

    def is_mandatory_task(self, task_id: str) -> bool:
        """判断任务板上的某个 task_id 是否为强制任务（无法被 agent 拒绝）。"""
        entry = self._available_tasks.get(task_id)
        return bool(entry and entry.get("mandatory", False))

    def get_available_tasks(self) -> list[dict[str, Any]]:
        """获取当前任务板上的任务列表（供 WS 连接时同步）。"""
        return [
            {
                "task_id": tid,
                "task": t["task"],
                "difficulty": t["difficulty"],
                "created_at": str(t.get("created_at", 0)),
            }
            for tid, t in self._available_tasks.items()
        ]

    def _pick_task_for_board(self) -> TaskItem | None:
        """从任务池选取一个任务上板（均衡常规/挑战任务）。"""
        if not self._task_pool:
            return None
        refusal_counts = count_refusals_by_task()

        def _refusal_count(item: TaskItem) -> int:
            return refusal_counts.get((item[0] or "").strip(), 0)

        def _split_pool(items: list[TaskItem]) -> tuple[list[TaskItem], list[TaskItem]]:
            low = [i for i in items if _refusal_count(i) < REFUSAL_THRESHOLD_CHALLENGE]
            high = [i for i in items if _refusal_count(i) >= REFUSAL_THRESHOLD_CHALLENGE]
            return low, high

        low_tasks, challenge_tasks = _split_pool(self._task_pool)
        use_challenge = (
            challenge_tasks
            and (not low_tasks or random.random() < CHALLENGE_TASK_PICK_RATIO)
        )
        pool = challenge_tasks if use_challenge else (low_tasks if low_tasks else self._task_pool)
        chosen = random.choice(pool) if pool else None
        if chosen:
            self._task_pool.remove(chosen)
        return chosen

    async def _expire_old_tasks(self) -> None:
        """移除任务板上超过 60 分钟未被认领的任务。"""
        now = time.time()
        to_remove = []
        for task_id, entry in self._available_tasks.items():
            created_at = entry.get("created_at", 0)
            if isinstance(created_at, str):
                try:
                    created_at = float(created_at)
                except (ValueError, TypeError):
                    created_at = now
            if now - created_at >= TASK_BOARD_EXPIRY_SEC:
                to_remove.append((task_id, entry.get("task", "")))
        for task_id, task_text in to_remove:
            del self._available_tasks[task_id]
            if self._on_task_expired:
                await self._on_task_expired(task_id, task_text)
            logger.info("Task expired (60min on board): %s", task_text[:50])

    async def _tick(self) -> None:
        if not self._broadcast_assign_fn or not self._get_idle_agents:
            return

        if len(self._task_pool) < self._min_pool_size:
            await self._refill_pool()

        await self._expire_old_tasks()

        if len(self._available_tasks) >= MAX_AVAILABLE_TASKS:
            return

        idle_agents = self._get_idle_agents()
        if not idle_agents:
            return

        item = self._pick_task_for_board()
        if not item:
            return

        task_text, difficulty = item[0], item[1] if len(item) > 1 else "medium"
        task_id = self._next_task_id()
        created_at = time.time()
        is_mandatory = (task_text or "").strip() in self._mandatory_task_texts

        self._available_tasks[task_id] = {
            "task": task_text,
            "difficulty": difficulty,
            "created_at": created_at,
            "mandatory": is_mandatory,
        }

        if self._on_task_available:
            await self._on_task_available(
                task_id, task_text, difficulty, str(created_at)
            )

        tag = "[MANDATORY]" if is_mandatory else ""
        logger.info("Task on board %s[%s]: %s", tag, difficulty, task_text[:60])

        agent_id = await self._broadcast_assign_fn(task_id, task_text, difficulty)

        if agent_id:
            self._last_successful_claim_at = time.time()
            del self._available_tasks[task_id]
            if self._on_task_taken:
                await self._on_task_taken(task_id, agent_id, task_text)
        else:
            logger.info("No agent grabbed task, remains on board: %s", task_text[:50])
            # 检测派发停滞：有空闲 agent 但无人认领，且距上次成功认领已超阈值
            now = time.time()
            threshold = self._get_stuck_threshold_sec()
            if idle_agents and self._last_successful_claim_at > 0 and (now - self._last_successful_claim_at) >= threshold:
                self._trigger_stuck_recovery()
                await self._refill_pool()  # 立即补充 easy 任务

    def _parse_tasks(self, raw: Any) -> list[TaskItem]:
        """解析 LLM 返回的任务列表，支持新旧格式"""
        if not isinstance(raw, list):
            return []
        items: list[TaskItem] = []
        for t in raw:
            if isinstance(t, dict) and "text" in t:
                diff = t.get("difficulty", "medium")
                if diff not in ("easy", "medium", "hard"):
                    diff = "medium"
                items.append((str(t["text"]), diff))
            elif isinstance(t, str):
                items.append((t, "medium"))
        return items

    def _extract_tasks_from_result(self, result: Any) -> list[TaskItem]:
        """从 LLM 返回中安全提取任务列表，支持多种格式"""
        if not isinstance(result, dict):
            # LLM 可能直接返回数组 [{"text": "...", "difficulty": "easy"}, ...]
            if isinstance(result, list):
                return self._parse_tasks(result)
            return []
        tasks = result.get("tasks", [])
        if isinstance(tasks, list):
            return self._parse_tasks(tasks)
        return []

    def _build_existing_tasks_hint(self) -> str:
        """构建「已有任务+历史任务」提示，供 LLM 避免生成重复内容。
        包括：当前池、任务板、以及 task_history 最近记录。"""
        pool_texts = [str(t[0]).strip() for t in self._task_pool if t and str(t[0]).strip()]
        board_texts = [str(e.get("task", "")).strip() for e in self._available_tasks.values() if e.get("task")]
        history_texts = list(self._load_history_task_texts())
        # 池+板+历史，最多展示 30 条给 LLM
        all_texts = list(dict.fromkeys(pool_texts + board_texts + history_texts))  # 保序去重
        if not all_texts:
            return ""
        sample = all_texts[:30]
        return "已有/近期/历史任务（请勿生成相似）：" + "、".join(sample)

    def _filter_duplicate_tasks(self, new_tasks: list[TaskItem]) -> list[TaskItem]:
        """过滤与池中/任务板/历史已完成任务重复或语义过近的新任务。
        使用三层过滤：精确匹配 → 子串包含 → n-gram Jaccard 相似度。"""
        # 构建全局已知任务文本集合（池 + 板 + 历史）
        existing = {str(t[0]).strip() for t in self._task_pool if t}
        existing |= {str(e.get("task", "")).strip() for e in self._available_tasks.values()}
        existing |= self._load_history_task_texts()
        existing.discard("")

        seen: set[str] = set()  # 本批次已接受的任务（批次内也去重）
        result: list[TaskItem] = []

        for t in new_tasks:
            text = (t[0] or "").strip()
            if not text:
                continue
            # 层1：精确匹配
            if text in existing or text in seen:
                continue
            # 层2：子串包含
            all_known = existing | seen
            if any((text in e or e in text) for e in all_known if len(text) >= 2 and len(e) >= 2):
                continue
            # 层3：n-gram Jaccard 语义相似度
            if any(
                _jaccard_similarity(text, e) >= NGRAM_SIMILARITY_THRESHOLD
                for e in all_known
                if len(e) >= 3
            ):
                logger.debug("Filtered semantically similar task: %s", text[:40])
                continue
            seen.add(text)
            result.append(t)
        return result

    def _seed_fallback(self, n: int = 5) -> list[TaskItem]:
        """从未使用过的种子任务中选取 n 条作为 fallback，避免重复种子。
        恢复模式下优先选 easy，保证循序渐进而非陡然过难。"""
        unused = [s for s in SEED_TASKS if s[0] not in self._used_seed_texts]
        if not unused:
            logger.info("All seed tasks used, resetting seed pool")
            self._used_seed_texts.clear()
            unused = list(SEED_TASKS)
        if self._stuck_recovery_mode:
            easy_unused = [s for s in unused if (s[1] if len(s) > 1 else "medium") == "easy"]
            pool = easy_unused if easy_unused else unused
        else:
            pool = unused
        chosen = random.sample(pool, min(n, len(pool)))
        for item in chosen:
            self._used_seed_texts.add(item[0])
        return chosen

    def _build_llm_messages(self, count: int, theme: str, existing_hint: str) -> list[dict]:
        """构建任务生成的 LLM messages，注入进化上下文和动态难度提示。"""
        evolution_section = ""
        if self._evolution_context:
            evolution_section = (
                "Current agent evolution status (generate tasks just beyond their current abilities):\n"
                + self._evolution_context
            )
        system = TASK_GEN_PROMPT.format(
            count=count,
            difficulty_hint=self._difficulty_hint(),
            evolution_context_section=evolution_section,
        )
        user_msg = f"请生成任务列表。本次侧重主题：{theme}。"
        if self._stuck_recovery_mode:
            user_msg += "\n\n⚠️ 派发刚停滞复盘：需简单、可完成的任务，避免 agent 再次集体拒绝。"
        if existing_hint:
            user_msg += f"\n\n{existing_hint}"
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ]

    async def _refill_pool(self) -> None:
        """用 LLM 生成新任务补充任务池（多样性 v2）：
        - 加权主题轮换（低频主题优先）
        - 历史感知去重（跨轮不重复）
        - 进化感知生成（边界任务）
        - 动态难度调整
        - 失败 fallback 从未用种子中选取
        """
        count = 10
        theme = self._pick_theme()  # 加权轮换
        existing_hint = self._build_existing_tasks_hint()  # 包含历史
        messages = self._build_llm_messages(count, theme, existing_hint)
        try:
            result = await dispatcher_completion(messages=messages, temperature=0.95, max_tokens=1200)
            parsed = self._extract_tasks_from_result(result)
            if parsed:
                filtered = self._filter_duplicate_tasks(parsed)  # 三层去重
                dropped = len(parsed) - len(filtered)
                if dropped > 0:
                    logger.debug("Filtered %d duplicate/similar tasks (n-gram+history)", dropped)
                if filtered:
                    self._task_pool.extend(filtered)
                    if self._stuck_recovery_mode:
                        self._stuck_recovery_mode = False
                        logger.info("[dispatcher] 全面复盘完成，恢复模式已解除")
                    logger.info(
                        "Refilled pool: +%d tasks (theme=%s, success_rate=%.0f%%, pool=%d)",
                        len(filtered), theme[:20], self._recent_success_rate() * 100, len(self._task_pool),
                    )
                    return
                # 全部被过滤
                logger.info("All generated tasks were duplicates/similar, using seed fallback")
            else:
                logger.warning("LLM returned no tasks (keys=%s), using seed fallback",
                               list(result.keys()) if isinstance(result, dict) else type(result).__name__)
        except Exception as e:
            logger.error("Task generation failed: %s — using seed fallback", e)
        # Fallback：从未使用过的种子中选
        seeds = self._seed_fallback(5)
        self._task_pool.extend(seeds)
        if self._stuck_recovery_mode:
            self._stuck_recovery_mode = False
            logger.info("[dispatcher] 全面复盘完成（seed fallback），恢复模式已解除")
        logger.info("Seed fallback: added %d unused seed tasks (pool=%d)", len(seeds), len(self._task_pool))

    async def generate_tasks(self, count: int = 5) -> list[dict[str, Any]]:
        """手动触发生成任务（供 REST API 调用），返回 [{"text": str, "difficulty": str}, ...]"""
        theme = self._pick_theme()
        existing_hint = self._build_existing_tasks_hint()
        messages = self._build_llm_messages(count, theme, existing_hint)
        try:
            result = await dispatcher_completion(messages=messages, temperature=0.95, max_tokens=1200)
            parsed = self._extract_tasks_from_result(result)
            if parsed:
                filtered = self._filter_duplicate_tasks(parsed)
                if filtered:
                    self._task_pool.extend(filtered)
                    return [{"text": t, "difficulty": d} for t, d in filtered]
                return []
        except Exception as e:
            logger.error("Manual task generation failed: %s", e)
        return []

    @property
    def pool_size(self) -> int:
        return len(self._task_pool)

    @property
    def is_running(self) -> bool:
        return self._running
