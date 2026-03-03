"""Evotown 任务分发器 — 自动生成任务并分配给空闲 Agent

职责：
  1. 用 LLM 根据 agent 能力/历史动态生成任务
  2. 周期性检查空闲 agent 并分发
  3. 维护任务池（预生成 + 实时生成）
  4. 按难度均衡分发，避免某 agent 长期只收到单一难度
  5. 平衡「可完成任务」与「挑战任务」：高拒绝任务代表生态未解决的能力缺口，保留并适度分发以引导进化
"""
import asyncio
import logging
import random
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from infra.execution_log import count_refusals_by_task
from infra.task_history import append_task_dropped
from llm_client import chat_completion

logger = logging.getLogger("evotown.dispatcher")

# (task_text, difficulty)
TaskItem = tuple[str, str]

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


@dataclass
class TaskDispatcher:
    """任务分发器"""
    _task_pool: list[TaskItem] = field(default_factory=lambda: list(SEED_TASKS))
    _running: bool = False
    _interval: float = 30.0  # 分发检查间隔（秒）
    _min_pool_size: int = 5
    _inject_fn: Callable[[str, str, str], Awaitable[bool]] | None = None  # (agent_id, task, difficulty)
    _get_idle_agents: Callable[[], list[str]] | None = None
    _get_agent_difficulty_counts: Callable[[str], dict[str, int]] | None = None
    _on_dispatched: Callable[[str, str, str], Awaitable[None]] | None = None  # (agent_id, task, difficulty)

    def configure(
        self,
        inject_fn: Callable[[str, str, str], Awaitable[bool]],
        get_idle_agents: Callable[[], list[str]],
        get_agent_difficulty_counts: Callable[[str], dict[str, int]] | None = None,
        on_dispatched: Callable[[str, str, str], Awaitable[None]] | None = None,
        interval: float = 30.0,
    ) -> None:
        self._inject_fn = inject_fn
        self._get_idle_agents = get_idle_agents
        self._get_agent_difficulty_counts = get_agent_difficulty_counts
        self._on_dispatched = on_dispatched
        self._interval = interval

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        logger.info("Task dispatcher started (interval=%.1fs)", self._interval)
        asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        logger.info("Task dispatcher stopped")

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._tick()
            except Exception as e:
                logger.error("Dispatcher tick error: %s", e)
            await asyncio.sleep(self._interval)

    def return_task_to_pool(self, task_text: str, difficulty: str) -> None:
        """将任务放回任务池（agent 拒绝时调用）。高拒绝任务保留更久，代表生态未解决的能力缺口。"""
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

    def _pick_task_for_agent(self, agent_id: str) -> TaskItem | None:
        """均衡分发：优先常规任务，按比例混入挑战任务（高拒绝=生态未解决，引导进化）"""
        if not self._task_pool:
            return None
        refusal_counts = count_refusals_by_task()

        def _refusal_count(item: TaskItem) -> int:
            return refusal_counts.get((item[0] or "").strip(), 0)

        def _split_pool(items: list[TaskItem]) -> tuple[list[TaskItem], list[TaskItem]]:
            """分为常规任务（低拒绝）与挑战任务（高拒绝）"""
            low = [i for i in items if _refusal_count(i) < REFUSAL_THRESHOLD_CHALLENGE]
            high = [i for i in items if _refusal_count(i) >= REFUSAL_THRESHOLD_CHALLENGE]
            return low, high

        def _pick_from(items: list[TaskItem], by_difficulty: bool) -> TaskItem | None:
            if not items:
                return None
            if not by_difficulty or not self._get_agent_difficulty_counts:
                return random.choice(items)
            counts = self._get_agent_difficulty_counts(agent_id)
            for difficulty in sorted(("easy", "medium", "hard"), key=lambda d: counts.get(d, 0)):
                cand = [i for i in items if (i[1] if len(i) > 1 else "medium") == difficulty]
                if cand:
                    return random.choice(cand)
            return random.choice(items)

        low_tasks, challenge_tasks = _split_pool(self._task_pool)
        # 约 CHALLENGE_TASK_PICK_RATIO 概率选挑战任务（生态未解决的能力缺口，给进化机会）
        use_challenge = (
            challenge_tasks
            and (not low_tasks or random.random() < CHALLENGE_TASK_PICK_RATIO)
        )
        pool = challenge_tasks if use_challenge else (low_tasks if low_tasks else self._task_pool)
        chosen = _pick_from(pool, by_difficulty=True)
        if chosen:
            self._task_pool.remove(chosen)
            if use_challenge:
                logger.debug("Picked challenge task (refused %d times): %s", _refusal_count(chosen), chosen[0][:40])
        return chosen

    async def _tick(self) -> None:
        if not self._inject_fn or not self._get_idle_agents:
            return

        if len(self._task_pool) < self._min_pool_size:
            await self._refill_pool()

        idle_agents = self._get_idle_agents()
        if not idle_agents:
            return

        for agent_id in idle_agents:
            item = self._pick_task_for_agent(agent_id)
            if not item:
                break
            task_text, difficulty = item[0], item[1] if len(item) > 1 else "medium"
            logger.info("[%s] dispatching task [%s]: %s", agent_id, difficulty, task_text[:60])
            ok = await self._inject_fn(agent_id, task_text, difficulty)
            if ok and self._on_dispatched:
                await self._on_dispatched(agent_id, task_text, difficulty)

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
        if not self._task_pool:
            return ""
        # 取池中任务 + 最近可能重复的，限制数量避免 token 过多
        sample = self._task_pool[-25:] if len(self._task_pool) > 25 else self._task_pool
        texts = [str(t[0]).strip() for t in sample if t and str(t[0]).strip()]
        if not texts:
            return ""
        return "已有/近期任务（请勿生成相似）：" + "、".join(texts[:20])

    def _filter_duplicate_tasks(self, new_tasks: list[TaskItem]) -> list[TaskItem]:
        """过滤与池中已有任务重复或过于相似的新任务"""
        existing = {str(t[0]).strip() for t in self._task_pool if t}
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
