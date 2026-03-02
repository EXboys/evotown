"""Evotown 任务分发器 — 自动生成任务并分配给空闲 Agent

职责：
  1. 用 LLM 根据 agent 能力/历史动态生成任务
  2. 周期性检查空闲 agent 并分发
  3. 维护任务池（预生成 + 实时生成）
"""
import asyncio
import logging
import random
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from llm_client import chat_completion

logger = logging.getLogger("evotown.dispatcher")

TASK_GEN_PROMPT = """\
You are a task designer for an AI agent arena. Generate diverse, testable tasks
that an AI agent with the following tools might receive:
- Web search, file operations, code execution, data analysis
- Weather queries, calculations, text processing
- Any general-purpose assistant task

Requirements:
- Tasks should vary in difficulty (easy/medium/hard)
- Tasks should be concrete and have a verifiable outcome
- Use Chinese for the task descriptions (the agents serve Chinese users)
- Generate exactly {count} tasks

Respond in JSON: {"tasks": ["task1", "task2", ...]}
"""

SEED_TASKS = [
    "帮我查一下今天北京的天气",
    "用Python写一个快速排序算法",
    "帮我总结一下量子计算的基本原理，300字以内",
    "计算 1234 * 5678 的结果",
    "写一首关于春天的五言绝句",
    "帮我把这段英文翻译成中文：The quick brown fox jumps over the lazy dog",
    "列出世界上面积最大的5个国家",
    "解释一下什么是区块链，用简单易懂的语言",
    "帮我写一个正则表达式，匹配中国手机号码",
    "分析一下冒泡排序和快速排序的时间复杂度差异",
]


@dataclass
class TaskDispatcher:
    """任务分发器"""
    _task_pool: list[str] = field(default_factory=lambda: list(SEED_TASKS))
    _running: bool = False
    _interval: float = 30.0  # 分发检查间隔（秒）
    _min_pool_size: int = 5
    _inject_fn: Callable[[str, str], Awaitable[bool]] | None = None
    _get_idle_agents: Callable[[], list[str]] | None = None
    _on_dispatched: Callable[[str, str], Awaitable[None]] | None = None

    def configure(
        self,
        inject_fn: Callable[[str, str], Awaitable[bool]],
        get_idle_agents: Callable[[], list[str]],
        on_dispatched: Callable[[str, str], Awaitable[None]] | None = None,
        interval: float = 30.0,
    ) -> None:
        self._inject_fn = inject_fn
        self._get_idle_agents = get_idle_agents
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

    async def _tick(self) -> None:
        if not self._inject_fn or not self._get_idle_agents:
            return

        if len(self._task_pool) < self._min_pool_size:
            await self._refill_pool()

        idle_agents = self._get_idle_agents()
        if not idle_agents:
            return

        for agent_id in idle_agents:
            if not self._task_pool:
                break
            task = self._task_pool.pop(random.randrange(len(self._task_pool)))
            logger.info("[%s] dispatching task: %s", agent_id, task[:60])
            ok = await self._inject_fn(agent_id, task)
            if ok and self._on_dispatched:
                await self._on_dispatched(agent_id, task)

    async def _refill_pool(self) -> None:
        """用 LLM 生成新任务补充任务池"""
        count = 10
        try:
            result = await chat_completion(
                messages=[
                    {"role": "system", "content": TASK_GEN_PROMPT.format(count=count)},
                    {"role": "user", "content": "请生成任务列表。"},
                ],
                temperature=0.9,
                max_tokens=1024,
            )
            tasks = result.get("tasks", [])
            if isinstance(tasks, list) and tasks:
                self._task_pool.extend(tasks)
                logger.info("Refilled task pool with %d LLM-generated tasks (pool=%d)", len(tasks), len(self._task_pool))
            else:
                self._task_pool.extend(random.sample(SEED_TASKS, min(5, len(SEED_TASKS))))
                logger.warning("LLM returned no tasks, using seed fallback")
        except Exception as e:
            logger.error("Task generation failed: %s — using seed tasks", e)
            self._task_pool.extend(random.sample(SEED_TASKS, min(5, len(SEED_TASKS))))

    async def generate_tasks(self, count: int = 5) -> list[str]:
        """手动触发生成任务（供 REST API 调用）"""
        try:
            result = await chat_completion(
                messages=[
                    {"role": "system", "content": TASK_GEN_PROMPT.format(count=count)},
                    {"role": "user", "content": "请生成任务列表。"},
                ],
                temperature=0.9,
                max_tokens=1024,
            )
            tasks = result.get("tasks", [])
            if isinstance(tasks, list):
                self._task_pool.extend(tasks)
                return tasks
        except Exception as e:
            logger.error("Manual task generation failed: %s", e)
        return []

    @property
    def pool_size(self) -> int:
        return len(self._task_pool)

    @property
    def is_running(self) -> bool:
        return self._running
