"""Evotown 任务分发器 — 任务板模式：任务上屏、全员可见、先到先得

职责：
  1. 用 LLM 根据 agent 能力/历史动态生成任务
  2. 任务加入任务板 → 广播 task_available（所有人可见）
  3. 向所有空闲 agent 并发发送预览，先 ACCEPT 者得
  4. 全部拒绝则任务保留在板，60 分钟后自动消失
  5. 多个任务可并存
"""
import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from infra.execution_log import count_refusals_by_task
from infra.task_history import append_task_dropped
from llm_client import chat_completion

logger = logging.getLogger("evotown.dispatcher")

# (task_text, difficulty)
TaskItem = tuple[str, str]

# 任务板上无人认领时，60 分钟后自动消失
TASK_BOARD_EXPIRY_SEC = 60 * 60

# 任务板与任务 NPC 最多同时存在数量
MAX_AVAILABLE_TASKS = 3

# 任务被拒绝此次数后才永久丢弃（高拒绝任务代表生态未解决的能力缺口，保留更久以引导进化）
MAX_REFUSAL_BEFORE_DROP = 8
# 拒绝次数 < 此值视为「常规任务」，>= 此值视为「挑战任务」
REFUSAL_THRESHOLD_CHALLENGE = 2
# 挑战任务选取概率：约 25% 时选高拒绝任务，给进化后的 agent 尝试机会
CHALLENGE_TASK_PICK_RATIO = 0.25

TASK_GEN_PROMPT = """\
You are a task designer for an AI agent arena. Generate tasks to **drive agent evolution** (skills, rules, memory).
Tools available: web search, file ops, code exec, calc, text. NO real-time weather API.

Evolution goal: Tasks MUST require **2+ tool calls** (evolution engine counts meaningful decisions only when total_tools>=2).
- easy: 至少2个工具（如 list_dir+read_file、search+calc）
- medium: 2步以上，搜索+计算/代码 或 多源比较
- hard: 多步推理、组合多种工具、需归纳规律

Rules:
- Each task 4-12 chars. Chinese only. Verifiable.
- **CRITICAL**: Every task must need 2+ tools. No 0-tool memory questions (e.g. "中国首都", "3的平方").
- Prefer: search+calc, search+code, file+code; comparison/sorting; tasks with retry potential.
- Do NOT generate weather tasks (no weather API).
- Avoid tasks similar to existing ones.
- Generate exactly {count} tasks

JSON: {"tasks": [{"text": "短任务", "difficulty": "easy|medium|hard"}, ...]}
"""

# 任务主题：侧重引导进化（多步、组合工具、易触发重规划/失败）
TASK_THEMES = [
    "搜索+计算：查数据后做运算",
    "搜索+代码：查文档后写示例",
    "多源比较、排序、筛选",
    "文件操作+统计/分析",
    "逻辑推理、归纳规律",
    "单位换算、日期计算",
    "API/库文档查询并调用",
    "多步验证、交叉校验",
]

# 种子任务：引导进化 — 需多步/组合工具/有失败可能，而非简单单步查
SEED_TASKS: list[TaskItem] = [
    ("比较俄罗斯和加拿大面积", "medium"),
    ("搜索Python最新版本并写Hello World", "medium"),
    ("计算2^10并验证位数", "medium"),
    ("找出3个以B开头的国家首都", "medium"),
    ("搜索2024春节日期并算距今天数", "medium"),
    ("用代码求1到50的素数个数", "medium"),
    ("比较俄加中三国面积并排序", "hard"),
    ("搜索某REST API文档并写调用示例", "hard"),
    ("读取当前目录txt文件并统计总行数", "hard"),
    ("计算10!并验证结果的位数", "hard"),
]


# 任务板条目：task_id -> {task, difficulty, created_at}
_AvailableTask = dict[str, Any]


@dataclass
class TaskDispatcher:
    """任务分发器 — 任务板模式"""
    _task_pool: list[TaskItem] = field(default_factory=lambda: list(SEED_TASKS))
    _available_tasks: dict[str, _AvailableTask] = field(default_factory=dict)  # task_id -> {task, difficulty, created_at}
    _task_id_counter: int = field(default=0)
    _running: bool = False
    _stop_event: asyncio.Event | None = field(default=None, repr=False)
    _interval: float = 30.0  # 分发检查间隔（秒）
    _min_pool_size: int = 5
    _broadcast_assign_fn: Callable[[str, str, str], Awaitable[str | None]] | None = None  # (task_id, task, difficulty) -> agent_id | None
    _get_idle_agents: Callable[[], list[str]] | None = None
    _get_agent_difficulty_counts: Callable[[str], dict[str, int]] | None = None
    _on_task_available: Callable[[str, str, str, str], Awaitable[None]] | None = None  # (task_id, task, difficulty, created_at)
    _on_task_taken: Callable[[str, str, str], Awaitable[None]] | None = None  # (task_id, agent_id, task)
    _on_task_expired: Callable[[str, str], Awaitable[None]] | None = None  # (task_id, task)

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

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        if self._stop_event is None:
            self._stop_event = asyncio.Event()
        self._stop_event.clear()
        logger.info("Task dispatcher started (interval=%.1fs)", self._interval)
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

    def return_task_to_pool(self, task_text: str, difficulty: str) -> None:
        """将任务放回任务池（兼容旧逻辑）。高拒绝任务保留更久，代表生态未解决的能力缺口。"""
        refusal_counts = count_refusals_by_task()
        count = refusal_counts.get((task_text or "").strip(), 0)
        if count >= MAX_REFUSAL_BEFORE_DROP:
            logger.info("Task dropped (refused %d times, >= %d): %s", count, MAX_REFUSAL_BEFORE_DROP, task_text[:50])
            try:
                from core.deps import experiment_id
                append_task_dropped(
                    experiment_id=experiment_id or "unknown",
                    task=task_text,
                    difficulty=difficulty,
                    refusal_count=count,
                )
            except Exception as e:
                logger.warning("Failed to append task dropped: %s", e)
            return
        self._task_pool.append((task_text, difficulty))
        logger.debug("Returned task to pool: [%s] %s (refused %d times)", difficulty, task_text[:40], count)

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

        self._available_tasks[task_id] = {
            "task": task_text,
            "difficulty": difficulty,
            "created_at": created_at,
        }

        if self._on_task_available:
            await self._on_task_available(
                task_id, task_text, difficulty, str(created_at)
            )

        logger.info("Task on board [%s]: %s", difficulty, task_text[:60])

        agent_id = await self._broadcast_assign_fn(task_id, task_text, difficulty)

        if agent_id:
            del self._available_tasks[task_id]
            if self._on_task_taken:
                await self._on_task_taken(task_id, agent_id, task_text)
        else:
            logger.info("No agent grabbed task, remains on board: %s", task_text[:50])

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
        """构建「已有任务」提示，供 LLM 避免重复"""
        pool_texts = [str(t[0]).strip() for t in self._task_pool if t and str(t[0]).strip()]
        board_texts = [str(e.get("task", "")).strip() for e in self._available_tasks.values() if e.get("task")]
        texts = (pool_texts[-25:] if len(pool_texts) > 25 else pool_texts) + board_texts
        if not texts:
            return ""
        return "已有/近期任务（请勿生成相似）：" + "、".join(texts[:20])

    def _filter_duplicate_tasks(self, new_tasks: list[TaskItem]) -> list[TaskItem]:
        """过滤与池中/任务板上已有任务重复或过于相似的新任务"""
        existing = {str(t[0]).strip() for t in self._task_pool if t}
        existing |= {str(e.get("task", "")).strip() for e in self._available_tasks.values()}
        seen: set[str] = set()
        result: list[TaskItem] = []
        for t in new_tasks:
            text = (t[0] or "").strip()
            if not text:
                continue
            if text in existing or text in seen:
                continue
            # 简单相似：互为子串则视为重复
            is_dup = any(
                text in e or e in text
                for e in (existing | seen)
                if len(text) >= 2 and len(e) >= 2
            )
            if is_dup:
                continue
            seen.add(text)
            result.append(t)
        return result

    async def _refill_pool(self) -> None:
        """用 LLM 生成新任务补充任务池，传入上下文促进多样性、引导进化"""
        count = 10
        theme = random.choice(TASK_THEMES)
        existing_hint = self._build_existing_tasks_hint()
        user_msg = f"请生成任务列表。本次侧重主题：{theme}。"
        if existing_hint:
            user_msg += f"\n\n{existing_hint}"
        try:
            result = await chat_completion(
                messages=[
                    {"role": "system", "content": TASK_GEN_PROMPT.format(count=count)},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.95,
                max_tokens=1024,
            )
            parsed = self._extract_tasks_from_result(result)
            if parsed:
                filtered = self._filter_duplicate_tasks(parsed)
                dropped = len(parsed) - len(filtered)
                if dropped > 0:
                    logger.debug("Filtered %d duplicate/similar tasks", dropped)
                if filtered:
                    self._task_pool.extend(filtered)
                    logger.info(
                        "Refilled task pool with %d tasks (theme=%s, pool=%d)",
                        len(filtered),
                        theme[:20],
                        len(self._task_pool),
                    )
                if not filtered and parsed:
                    # 全部被过滤，用种子补充
                    self._task_pool.extend(random.sample(SEED_TASKS, min(5, len(SEED_TASKS))))
                    logger.info("All generated tasks were duplicates, used seed fallback")
            else:
                self._task_pool.extend(random.sample(SEED_TASKS, min(5, len(SEED_TASKS))))
                logger.warning("LLM returned no tasks (raw_keys=%s), using seed fallback",
                              list(result.keys()) if isinstance(result, dict) else type(result).__name__)
        except Exception as e:
            logger.error("Task generation failed: %s — using seed tasks", e)
            self._task_pool.extend(random.sample(SEED_TASKS, min(5, len(SEED_TASKS))))

    async def generate_tasks(self, count: int = 5) -> list[dict[str, Any]]:
        """手动触发生成任务（供 REST API 调用），返回 [{"text": str, "difficulty": str}, ...]"""
        theme = random.choice(TASK_THEMES)
        existing_hint = self._build_existing_tasks_hint()
        user_msg = f"请生成任务列表。本次侧重主题：{theme}。"
        if existing_hint:
            user_msg += f"\n\n{existing_hint}"
        try:
            result = await chat_completion(
                messages=[
                    {"role": "system", "content": TASK_GEN_PROMPT.format(count=count)},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.95,
                max_tokens=1024,
            )
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
