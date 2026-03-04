"""竞技场内存状态"""
from __future__ import annotations

import random
from typing import Any, Optional

from infra.persistence import load_state as load_persisted, save_state as save_persisted

# 待办任务元数据：task, difficulty, task_id
PendingTaskMeta = dict[str, Any]

# Agent 展示名字池（24 个有个性的名字）
_AGENT_NAME_POOL: list[str] = [
    "Nova", "Rex", "Aria", "Zeno", "Luna", "Kai",
    "Mira", "Orion", "Sage", "Vex", "Echo", "Dusk",
    "Flux", "Lyra", "Bolt", "Nyx", "Zara", "Axel",
    "Cleo", "Dex", "Ember", "Finn", "Gaia", "Hex",
]


class AgentRecord:
    """单个 Agent 的内存记录"""

    __slots__ = ("agent_id", "display_name", "agent_home", "chat_dir", "balance", "status", "in_task", "soul_type", "_observer")

    def __init__(
        self,
        agent_id: str,
        agent_home: str,
        chat_dir: str,
        balance: int = 100,
        status: str = "active",
        in_task: bool = False,
        soul_type: str = "balanced",
        observer: Any = None,
        display_name: str = "",
    ) -> None:
        self.agent_id = agent_id
        self.display_name = display_name or agent_id
        self.agent_home = agent_home
        self.chat_dir = chat_dir
        self.balance = balance
        self.status = status
        self.in_task = in_task
        self.soul_type = soul_type
        self._observer = observer

    def to_serializable(self) -> dict[str, Any]:
        return {
            "id": self.agent_id,
            "display_name": self.display_name,
            "balance": self.balance,
            "status": self.status,
            "soul_type": self.soul_type,
        }


class ArenaState:
    """竞技场内存状态"""

    def __init__(self) -> None:
        self._agents: dict[str, AgentRecord] = {}
        self._agent_counter = 0
        self._task_counter = 0
        self._pending_tasks: dict[str, PendingTaskMeta] = {}
        self._agent_task_count: dict[str, int] = {}
        self._last_evolve_at: dict[str, int] = {}
        self._agent_difficulty_count: dict[str, dict[str, int]] = {}  # agent_id -> {easy:N, medium:N, hard:N}
        self._used_names: set[str] = set()

    def assign_display_name(self) -> str:
        """从名字池随机分配一个未被使用的展示名（池用尽后加数字后缀）"""
        available = [n for n in _AGENT_NAME_POOL if n not in self._used_names]
        if available:
            name = random.choice(available)
        else:
            # 全部用完，加数字后缀
            i = 1
            while True:
                name = f"{random.choice(_AGENT_NAME_POOL)}{i}"
                if name not in self._used_names:
                    break
                i += 1
        self._used_names.add(name)
        return name

    def release_display_name(self, name: str) -> None:
        """Agent 退场时归还名字"""
        self._used_names.discard(name)

    @property
    def agent_counter(self) -> int:
        return self._agent_counter

    @property
    def agents(self) -> dict[str, AgentRecord]:
        return self._agents

    def next_agent_id(self) -> str:
        self._agent_counter += 1
        return f"agent_{self._agent_counter}"

    def add_agent(self, record: AgentRecord) -> None:
        self._agents[record.agent_id] = record
        # 确保名字被标记为已使用（恢复状态时也需要注册）
        if record.display_name:
            self._used_names.add(record.display_name)

    def remove_agent(self, agent_id: str) -> Optional[AgentRecord]:
        rec = self._agents.pop(agent_id, None)
        if rec:
            self.release_display_name(rec.display_name)
        return rec

    def get_agent(self, agent_id: str) -> Optional[AgentRecord]:
        return self._agents.get(agent_id)

    def has_agent(self, agent_id: str) -> bool:
        return agent_id in self._agents

    def add_balance(self, agent_id: str, delta: int, default: int = 100) -> None:
        if a := self._agents.get(agent_id):
            a.balance = a.balance + delta

    def set_in_task(self, agent_id: str, in_task: bool) -> None:
        if a := self._agents.get(agent_id):
            a.in_task = in_task

    def next_task_id(self) -> str:
        self._task_counter += 1
        return f"task_{self._task_counter}"

    def set_pending_task(
        self,
        agent_id: str,
        task: str,
        difficulty: str = "medium",
        task_id: str | None = None,
    ) -> None:
        tid = task_id or self.next_task_id()
        self._pending_tasks[agent_id] = {"task": task, "difficulty": difficulty, "task_id": tid}

    def record_task_difficulty(self, agent_id: str, difficulty: str) -> None:
        """任务完成后记录难度，用于均衡分发"""
        counts = self._agent_difficulty_count.setdefault(agent_id, {"easy": 0, "medium": 0, "hard": 0})
        counts[difficulty] = counts.get(difficulty, 0) + 1

    def pop_pending_task(self, agent_id: str) -> PendingTaskMeta | None:
        meta = self._pending_tasks.pop(agent_id, None)
        if meta and isinstance(meta, dict):
            return meta
        if isinstance(meta, str):
            return {"task": meta, "difficulty": "medium", "task_id": ""}
        return None

    def inc_task_count(self, agent_id: str) -> int:
        self._agent_task_count[agent_id] = self._agent_task_count.get(agent_id, 0) + 1
        return self._agent_task_count[agent_id]

    def get_last_evolve_at(self, agent_id: str) -> int:
        return self._last_evolve_at.get(agent_id, 0)

    def set_last_evolve_at(self, agent_id: str, count: int) -> None:
        self._last_evolve_at[agent_id] = count

    def get_idle_agent_ids(self) -> list[str]:
        return [aid for aid, a in self._agents.items() if a.status == "active" and not a.in_task]

    def get_agent_difficulty_counts(self, agent_id: str) -> dict[str, int]:
        """返回该 agent 各难度已执行任务数，用于均衡分发"""
        return dict(self._agent_difficulty_count.get(agent_id, {"easy": 0, "medium": 0, "hard": 0}))

    def restore_counter(self, counter: int) -> None:
        self._agent_counter = counter

    def restore_task_counter(self, counter: int) -> None:
        self._task_counter = counter

    def persist(self, experiment_id: str | None = None) -> None:
        agents_payload = [a.to_serializable() for a in self._agents.values()]
        save_persisted(
            self._agent_counter,
            agents_payload,
            experiment_id=experiment_id,
            task_counter=self._task_counter,
        )
