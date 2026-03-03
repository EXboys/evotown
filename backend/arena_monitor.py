"""Evotown 竞技场监控 — 实时追踪 agent 执行过程，汇总上下文供裁判评分

每个 agent 执行任务时，monitor 会：
  1. 收集事件流（task_plan, tool_call, tool_result, text, done）
  2. 汇总结构化统计（工具成功/失败数、耗时等）
  3. 任务结束时提供完整执行上下文给 judge
  4. 通过回调将实时事件推送给前端
"""
import logging
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("evotown.monitor")

_INTERNAL_TOOLS = frozenset({"update_task_plan"})


@dataclass
class TaskExecution:
    """单次任务执行的完整上下文"""
    agent_id: str
    task: str = ""
    start_ts: float = field(default_factory=time.time)

    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    tool_total: int = 0
    tool_failed: int = 0
    text_chunks: list[str] = field(default_factory=list)
    task_plans: list[dict[str, Any]] = field(default_factory=list)
    response: str = ""
    task_completed: bool = False
    elapsed_ms: float = 0

    def on_tool_call(self, name: str, arguments: str) -> None:
        self.tool_calls.append({"name": name, "arguments": arguments, "result": None, "is_error": False})

    def on_tool_result(self, name: str, result: str, is_error: bool) -> None:
        if name not in _INTERNAL_TOOLS:
            self.tool_total += 1
            if is_error:
                self.tool_failed += 1
        if self.tool_calls and self.tool_calls[-1]["name"] == name:
            self.tool_calls[-1]["result"] = result[:500]
            self.tool_calls[-1]["is_error"] = is_error

    def on_text(self, text: str) -> None:
        self.text_chunks.append(text)

    def on_task_plan(self, plan: dict[str, Any]) -> None:
        self.task_plans.append(plan)

    def on_done(self, data: dict[str, Any]) -> None:
        self.response = data.get("response", "")
        self.task_completed = data.get("task_completed", False)
        self.elapsed_ms = (time.time() - self.start_ts) * 1000

    @property
    def all_tools_failed(self) -> bool:
        return self.tool_total > 0 and self.tool_failed >= self.tool_total

    def summary(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "task": self.task,
            "response": self.response[:500],
            "tool_total": self.tool_total,
            "tool_failed": self.tool_failed,
            "task_completed": self.task_completed,
            "elapsed_ms": round(self.elapsed_ms),
            "plans_count": len(self.task_plans),
            "text_length": sum(len(c) for c in self.text_chunks),
        }


class ArenaMonitor:
    """竞技场全局监控"""

    def __init__(self) -> None:
        self._active: dict[str, TaskExecution] = {}
        self._history: list[dict[str, Any]] = []
        self._max_history = 200

    def begin_task(self, agent_id: str, task: str) -> TaskExecution:
        exe = TaskExecution(agent_id=agent_id, task=task)
        self._active[agent_id] = exe
        logger.info("[%s] monitoring task: %s", agent_id, task[:80])
        return exe

    def get_execution(self, agent_id: str) -> TaskExecution | None:
        return self._active.get(agent_id)

    def end_task(self, agent_id: str) -> TaskExecution | None:
        exe = self._active.pop(agent_id, None)
        if exe:
            summary = exe.summary()
            self._history.append(summary)
            if len(self._history) > self._max_history:
                self._history = self._history[-self._max_history:]
            logger.info("[%s] task ended: %s", agent_id, summary)
        return exe

    def process_event(self, agent_id: str, event: str, data: dict[str, Any]) -> None:
        """处理来自 agent stdout 的事件"""
        exe = self._active.get(agent_id)
        if not exe:
            return

        if event == "tool_call":
            exe.on_tool_call(data.get("name", ""), data.get("arguments", ""))
        elif event == "tool_result":
            exe.on_tool_result(data.get("name", ""), data.get("result", ""), data.get("is_error", False))
        elif event == "text":
            exe.on_text(data.get("text", ""))
        elif event == "text_chunk":
            exe.on_text(data.get("text", ""))
        elif event == "task_plan":
            exe.on_task_plan(data)
        elif event == "done":
            exe.on_done(data)

    @property
    def active_tasks(self) -> dict[str, dict[str, Any]]:
        return {aid: exe.summary() for aid, exe in self._active.items()}

    @property
    def history(self) -> list[dict[str, Any]]:
        return list(self._history)

    def get_timed_out_agent_ids(self, timeout_seconds: float) -> list[str]:
        """返回执行时间超过 timeout_seconds 的 agent_id 列表"""
        now = time.time()
        return [
            aid for aid, exe in self._active.items()
            if (now - exe.start_ts) >= timeout_seconds
        ]

    def stats(self) -> dict[str, Any]:
        completed = [h for h in self._history if h["task_completed"]]
        failed = [h for h in self._history if not h["task_completed"]]
        return {
            "active_tasks": len(self._active),
            "total_completed": len(self._history),
            "success_count": len(completed),
            "fail_count": len(failed),
            "success_rate": len(completed) / max(len(self._history), 1),
            "avg_elapsed_ms": sum(h["elapsed_ms"] for h in self._history) / max(len(self._history), 1),
        }
