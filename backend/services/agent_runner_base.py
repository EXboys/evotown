"""Agent runner 统一抽象接口。

Runner 层负责"如何执行 Agent"——SDK 调用还是 CLI 子进程，gateway 配置，
事件回调。编排层负责上下文准备（技能/MCP/知识/身份），通过接口注入
context 和 on_message 回调。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol


# ── 数据模型 ──────────────────────────────────────────────────────


@dataclass
class AgentRunResult:
    """Runner 执行结果，所有 engine 统一返回。"""
    exit_code: int
    output: str                              # 最终结果文本（给用户看的）
    raw_output: str = ""                     # 原始数据流（stream-json / session_id 等）


@dataclass
class AgentRunContext:
    """一次 Agent 运行的上下文标识。

    Runner 内部通过属性访问（ctx.run_id），不再依赖 claude_agent_runs 的
    dict 结构。编排层从 DB dict 构造好后传入。
    """
    run_id: str
    agent_id: str
    prompt: str = ""
    model: str = ""
    account_id: str = ""
    team_id: str = ""
    tenant_id: str = ""

    # ── Gateway 鉴权 ──
    gateway_api_key: str = ""
    gateway_base_url: str = ""

    # ── Claude SDK 专属 ──
    resume_session_id: str = ""              # 编排层查 DB 后填入，非 claude runner 忽略


# ── Runner 接口 ────────────────────────────────────────────────────


class AgentRunner(Protocol):
    """所有 Coding Agent runner 统一接口。

    每个 engine（claude / codex / hermes）实现此接口。Runner 内部自行
    决定 backend（SDK / CLI / dry-run），编排层不感知 backend 差异。

    回调:
    - on_message: runner 产出中间文本时回调（编排层负责写库 + SSE 推送）
    - on_tool_call: runner 发起工具调用时回调（可选，当前仅 Claude CLI 使用）
    """

    @property
    def engine(self) -> str:
        """引擎标识: "claude" / "codex" / "hermes" """
        ...

    def is_available(self) -> bool:
        """返回当前环境下此 engine 是否可用（SDK 可导入 OR CLI 在 PATH）。"""
        ...

    def resolve_backend(self) -> str:
        """返回本次 run 使用的 backend: "sdk" / "cli" / "dry-run"。

        决策逻辑: 环境变量显式配置 > 优先级链（SDK > CLI > dry-run）
        """
        ...

    async def run(
        self,
        *,
        workspace_root: Path,
        prompt: str,
        model: str,
        context: AgentRunContext,
        on_message: Callable[[str], None] | None = None,
        on_tool_call: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> AgentRunResult:
        """执行一次 Agent 运行。"""
        ...
