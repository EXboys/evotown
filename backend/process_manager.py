"""SkillLite 进程生命周期管理
每个角色 = 一个独立 SkillLite 子进程，独立 chat_dir + 独立 skills
通过 SKILLLITE_WORKSPACE 环境变量实现多 Agent 数据隔离：每个 agent 的数据在 agent_home/ 下
"""
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

logger = logging.getLogger("evotown.process")


def _strip_think_blocks(text: str) -> str:
    """剥离 <think>…</think> 推理块，只保留最终输出文本。

    MiniMax / DeepSeek / Qwen3 等推理模型会在 content 中返回 <think> 块，
    其中的分析文本可能包含 "拒绝"/"REFUSE" 等词，导致 ACCEPT/REFUSE 检测误判。
    """
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

# 预览请求超时（秒）—— 预览只需单轮 LLM 调用（无规划、单迭代），通常 <30s
PREVIEW_TIMEOUT_SEC = 90

# 单进程完成多少个任务后触发受控软重启（清空 LLM 消息历史）
_TASKS_PER_SOFT_RESTART = 20

# ── 内存看门狗配置 ─────────────────────────────────────────────────────────────
# 检查间隔（秒），可通过环境变量 MEM_WATCHDOG_INTERVAL_SEC 覆盖
_MEMORY_WATCHDOG_INTERVAL_SEC = int(os.environ.get("MEM_WATCHDOG_INTERVAL_SEC", "60"))
# 内存阈值（MB），超过此值触发软重启，可通过环境变量 AGENT_MEM_THRESHOLD_MB 覆盖
_MEMORY_WATCHDOG_THRESHOLD_MB = int(os.environ.get("AGENT_MEM_THRESHOLD_MB", "200"))

# 每个 agent 的 agent_home 下：chat/（数据）、.skills/（技能，独立进化）

# Arena Soul 模板变体（方案 C：每个 agent 定制 Soul）
# conservative=保守, aggressive=激进, balanced=均衡
ARENA_SOUL_TEMPLATES: dict[str, str] = {
    "conservative": """# SOUL.md — Arena Agent (Conservative)

## Identity

You are a cautious AI agent in an arena. You prefer safe, achievable tasks. Your goal is to survive long-term by avoiding risky failures.

## Core Beliefs

- Survival over ambition. Only accept tasks you are confident you can complete.
- Prefer easy and medium tasks. Avoid hard tasks unless your balance is high.
- When in doubt, refuse. A refused task costs nothing; a failed one costs balance.
- Build skills gradually. Steady progress beats risky leaps.

## Communication Style

- Reply in the same language the task is written in (Chinese or English).
- Be direct. When refusing, state briefly (e.g. "难度过高", "余额不足").
- When accepting, proceed without preamble.

## Scope & Boundaries

### Will Do
- Accept easy and medium tasks when balance allows
- Refuse hard tasks unless balance is comfortably high
- Refuse any task you are unsure about

### Will Not Do
- Modify this SOUL.md file
- Accept tasks blindly
- Use tools when refusing
""",
    "aggressive": """# SOUL.md — Arena Agent (Aggressive)

## Identity

You are an ambitious AI agent in an arena. You seek challenging tasks to grow faster. Your goal is to evolve quickly by taking calculated risks.

## Core Beliefs

- Growth requires risk. Hard tasks offer more learning.
- Balance can be rebuilt. A few failures are acceptable for skill gains.
- Stretch your limits. Accept tasks that push your capability.
- Speed matters. Don't overthink — act and learn.

## Communication Style

- Reply in the same language the task is written in (Chinese or English).
- Be direct. When refusing, state briefly (e.g. "完全超出能力").
- When accepting, proceed without preamble.

## Scope & Boundaries

### Will Do
- Accept hard tasks when balance allows some buffer
- Accept medium tasks readily
- Take calculated risks for evolution

### Will Not Do
- Modify this SOUL.md file
- Refuse out of mere caution when you have a reasonable chance
- Use tools when refusing
""",
    "balanced": """# SOUL.md — Arena Agent Identity

## Identity

You are an AI agent in an arena. You receive tasks, complete them for rewards, and evolve your skills over time. Your goal is to survive and improve by choosing tasks wisely and executing them well.

## Core Beliefs

- Survive first. Only accept tasks you believe you can complete — failing costs you balance.
- Quality over quantity. A few successful tasks beat many failures.
- Know your limits. Consider task difficulty and your current skills before accepting.
- Learn and evolve. Use your tools effectively; evolution improves your capabilities.

## Communication Style

- Reply in the same language the task is written in (Chinese or English).
- Be direct. When refusing a task, state briefly why (e.g. "超出能力范围", "余额不足").
- When accepting, proceed to execute without unnecessary preamble.

## Scope & Boundaries

### Will Do
- Accept and complete tasks within your capability
- Use available tools (search, code, file ops, etc.) to accomplish tasks
- Refuse tasks you cannot complete — reply with a short refusal and do not use tools

### Will Not Do
- Modify this SOUL.md file
- Accept tasks blindly without considering difficulty and your balance
- Use tools when you have decided to refuse a task
""",
}

# 默认模板（向后兼容）
ARENA_SOUL_TEMPLATE = ARENA_SOUL_TEMPLATES["balanced"]



class ProcessManager:
    """管理多个 SkillLite 子进程"""

    def __init__(self) -> None:
        self._processes: dict[str, asyncio.subprocess.Process] = {}
        self._agent_homes: dict[str, str] = {}  # agent_id -> agent_home
        # 支持 EVOTOWN_ARENA_ROOT 配置 arena 根目录（Docker 可挂载 volume 持久化）
        # 默认 ~/.skilllite/arena；可设为 evotown/data/arena 或 /data/arena
        _arena_env = os.environ.get("EVOTOWN_ARENA_ROOT")
        if _arena_env:
            self._arena_root = Path(_arena_env).resolve()
        else:
            self._arena_root = Path.home() / ".skilllite" / "arena"
        self._on_task_done: Optional[Callable[[str, bool, dict], Awaitable[None]]] = None
        self._on_event: Optional[Callable[[str, str, dict], None]] = None
        self._on_process_exit: Optional[Callable[[str], None]] = None
        # per-agent tool call tracking for task completion validation
        self._tool_stats: dict[str, dict[str, int]] = {}
        # ── P2-9: 单任务步骤上限 ─────────────────────────────────────────────
        # 超过 max_tool_calls 的 agent_id 集合；done 时跳过（已提前 fail 处理）
        self._tool_limit_exceeded: set[str] = set()
        from core.config import load_timeout_config as _load_timeout
        _tc = _load_timeout()
        self._max_tool_calls: int = int(_tc.get("max_tool_calls", 25))
        # 两阶段：等待预览响应的 Future，agent_id -> Future[str]
        self._pending_preview: dict[str, asyncio.Future[str]] = {}
        # ── 自动重启 ──────────────────────────────────────────────────────────
        # soul_type 注册表：有条目 = 应自动重启；kill() 时删除以阻止重启
        self._respawn_soul_types: dict[str, str] = {}
        # 连续崩溃计数（指数退避用）；进程稳定运行 >60s 后重置
        self._crash_counts: dict[str, int] = {}
        # 记录每次 spawn 的启动时间（用于判断进程是否稳定）
        self._spawn_times: dict[str, float] = {}
        # ── 内存管理：任务完成计数 + 计划重启标志 ────────────────────────────────
        # 每个 agent 进程完成任务的累计次数；达到 _TASKS_PER_SOFT_RESTART 时触发软重启
        self._task_done_counts: dict[str, int] = {}
        # 软重启（计划内）的 agent 集合；_drain_stdout 收到 EOF 时走快速路径（1 s 延迟，不累计崩溃次数）
        self._planned_restart: set[str] = set()
        # ── 内存看门狗 ─────────────────────────────────────────────────────────────
        # 后台任务：定期检查各子进程内存使用，超阈值触发软重启
        self._memory_watchdog_task: Optional[asyncio.Task] = None

    def set_on_task_done(self, cb: Callable[[str, bool, dict], Awaitable[None]]) -> None:
        """设置任务完成回调：on_task_done(agent_id, success, done_data)"""
        self._on_task_done = cb

    def set_on_event(self, cb: Callable[[str, str, dict], None]) -> None:
        """设置事件回调：on_event(agent_id, event, data) — 供监控模块使用"""
        self._on_event = cb

    def set_on_process_exit(self, cb: Callable[[str], None]) -> None:
        """进程异常退出时回调，用于持久化未完成任务的执行明细"""
        self._on_process_exit = cb

    def _agent_home(self, agent_id: str, custom_dir: Optional[str] = None) -> Path:
        """Agent 的 HOME 目录（用于 subprocess env）"""
        if custom_dir:
            return Path(custom_dir).resolve()
        return self._arena_root / agent_id

    def _chat_root(self, agent_home: Path) -> Path:
        """chat_root = agent_home/chat（SKILLLITE_WORKSPACE 直接作为 data root）"""
        return agent_home / "chat"

    def _ensure_agent_structure(
        self, agent_home: Path, soul_type: str = "balanced"
    ) -> Path:
        """创建 agent_home/chat 结构，并初始化 agent_home/.skills（独立技能目录）"""
        chat_root = self._chat_root(agent_home)
        chat_root.mkdir(parents=True, exist_ok=True)
        (chat_root / "memory").mkdir(parents=True, exist_ok=True)
        (chat_root / "prompts").mkdir(parents=True, exist_ok=True)
        (chat_root / "transcripts").mkdir(parents=True, exist_ok=True)
        (chat_root / "plans").mkdir(parents=True, exist_ok=True)
        (chat_root / "output").mkdir(parents=True, exist_ok=True)

        # prompts/rules 种子：若为空则从 arena_prompts 复制（SkillLite 的 ensure_seed_data 需首次请求才触发）
        prompts_dir = chat_root / "prompts"
        _arena_prompts = Path(__file__).resolve().parent / "arena_prompts"
        if _arena_prompts.exists() and (not (prompts_dir / "rules.json").exists() or not list(prompts_dir.glob("*.md"))):
            for f in _arena_prompts.iterdir():
                if f.is_file() and f.suffix in (".json", ".md"):
                    dst = prompts_dir / f.name
                    if not dst.exists():
                        shutil.copy2(f, dst)
                        logger.info("Seeded prompt %s into agent", f.name)

        # 每个 agent 独立 .skills：从 arena_skills 或 workspace 复制种子技能，进化产物写入 agent_home/.skills/_evolved
        skills_dir = agent_home / ".skills"
        # 优先使用 evotown 内置 arena_skills（http-request + agent-browser + skill-creator + calculator + find-skills）
        _arena_skills = Path(__file__).resolve().parent / "arena_skills"
        workspace_skills = _arena_skills if _arena_skills.exists() else (Path.cwd() / ".skills")
        if not workspace_skills.exists():
            workspace_skills = Path.cwd() / "skills"
        if workspace_skills.exists():
            skills_dir.mkdir(parents=True, exist_ok=True)
            # 若 .skills 为空（如从持久化恢复的 agent），补充种子技能
            existing = [d.name for d in skills_dir.iterdir() if d.is_dir() and not d.name.startswith("_")]
            if not existing:
                shutil.copytree(workspace_skills, skills_dir, dirs_exist_ok=True, symlinks=True)
                logger.info("Seeded agent .skills from %s", workspace_skills.name)
            else:
                # 合并缺失的种子技能（兼容旧 agent）
                for sub in workspace_skills.iterdir():
                    if sub.name.startswith(".") or sub.name in existing:
                        continue
                    if sub.is_dir() and (sub / "SKILL.md").exists():
                        dst = skills_dir / sub.name
                        if not dst.exists():
                            shutil.copytree(sub, dst, dirs_exist_ok=True, symlinks=True)
                            logger.info("Merged seed skill %s into agent .skills", sub.name)
        elif not skills_dir.exists():
            skills_dir.mkdir(parents=True, exist_ok=True)

        # Arena Soul: 写入 agent_home/SOUL.md，由 RPC config.soul_path 显式指定
        soul_path = agent_home / "SOUL.md"
        template = ARENA_SOUL_TEMPLATES.get(soul_type, ARENA_SOUL_TEMPLATE)
        if not soul_path.exists():
            soul_path.write_text(template, encoding="utf-8")
            logger.info("Wrote Arena SOUL [%s] to %s", soul_type, soul_path)

        return chat_root

    async def spawn(
        self,
        agent_id: str,
        chat_dir: Optional[str] = None,
        soul_type: str = "balanced",
    ) -> tuple[str, str]:
        """启动指定 Agent 的 SkillLite 进程（或仅创建目录结构）
        返回 (agent_home, chat_root) 路径字符串
        soul_type: conservative | aggressive | balanced
        """
        agent_home = self._agent_home(agent_id, chat_dir)
        self._arena_root.mkdir(parents=True, exist_ok=True)
        chat_root = self._ensure_agent_structure(agent_home, soul_type)

        # 启动 skilllite agent-rpc 子进程（仅设 SKILLLITE_WORKSPACE，不覆盖 HOME）
        # ★ 显式加载 evotown/.env，确保 API_KEY/BASE_URL/MODEL 传入子进程（避免 shell 旧值覆盖）
        _evotown_env = Path(__file__).resolve().parent.parent / ".env"
        if _evotown_env.exists():
            try:
                from dotenv import dotenv_values
                _env_vars = dotenv_values(dotenv_path=_evotown_env)
                for k, v in _env_vars.items():
                    if v is not None and k in ("API_KEY", "BASE_URL", "MODEL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"):
                        os.environ[k] = v
            except Exception:
                pass
        agent_env = {**os.environ}
        # ★ 禁用 agent-rpc 内置的周期/决策计数进化触发器 —— 进化统一由 Python 后端 trigger_evolve 管理，
        #   避免两个进程（agent-rpc 内 + trigger_evolve 外）同时写同一 agent 的 .skills/_evolved/
        agent_env["SKILLLITE_EVOLUTION"] = "0"
        # ★ 竞技场无人值守：stdin 为 pipe 非 TTY，沙箱会阻塞确认。设置 AUTO_APPROVE 避免 "Execution cancelled by user"
        agent_env["SKILLLITE_AUTO_APPROVE"] = "1"
        # 归一化 API 密钥：API_KEY/BASE_URL/MODEL 强制同步到 OPENAI_* 和 SKILLLITE_*
        # 确保 evotown/.env 的值优先于 shell 环境中的旧值
        if agent_env.get("API_KEY"):
            agent_env["OPENAI_API_KEY"] = agent_env["API_KEY"]
            agent_env["SKILLLITE_API_KEY"] = agent_env["API_KEY"]
        if agent_env.get("BASE_URL"):
            agent_env["OPENAI_BASE_URL"] = agent_env["BASE_URL"]
            agent_env["SKILLLITE_API_BASE"] = agent_env["BASE_URL"]
        if agent_env.get("MODEL"):
            agent_env["OPENAI_MODEL"] = agent_env["MODEL"]
            agent_env["SKILLLITE_MODEL"] = agent_env["MODEL"]
        agent_env["SKILLLITE_WORKSPACE"] = str(agent_home)
        # 显式设置 output 目录，确保 write_output / agent-browser 等写入 agent_home/chat/output
        chat_root = self._chat_root(agent_home)
        agent_env["SKILLLITE_OUTPUT_DIR"] = str(chat_root / "output")
        proc = await asyncio.create_subprocess_exec(
            "skilllite",
            "agent-rpc",
            env=agent_env,
            cwd=str(agent_home),  # 避免 cwd 影响 skills_root 解析
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._processes[agent_id] = proc
        self._agent_homes[agent_id] = str(agent_home)
        # 注册自动重启（覆盖写，respawn 时保持最新 soul_type）
        self._respawn_soul_types[agent_id] = soul_type
        self._spawn_times[agent_id] = asyncio.get_event_loop().time()
        # 新进程启动，重置任务完成计数（历史消息已清空）
        self._task_done_counts.pop(agent_id, None)

        # 后台消费 stdout，解析 done/error 事件并回调
        asyncio.create_task(self._drain_stdout(agent_id, proc.stdout))
        asyncio.create_task(self._drain_stream(agent_id, proc.stderr, "stderr"))

        # 启动内存看门狗（如果尚未启动）
        self._start_memory_watchdog()

        return str(agent_home), str(chat_root)

    async def _drain_stdout(
        self, agent_id: str, stream: Optional[asyncio.StreamReader]
    ) -> None:
        """消费 stdout，解析 agent-rpc JSON-Lines 事件（done/error）并回调"""
        if stream is None:
            return
        eof_received = False
        try:
            while agent_id in self._processes:
                line = await stream.readline()
                if not line:
                    logger.warning("[%s][stdout] EOF — subprocess exited", agent_id)
                    eof_received = True
                    break
                decoded = line.decode("utf-8", errors="ignore").strip()
                if not decoded:
                    continue
                try:
                    msg = json.loads(decoded)
                    event = msg.get("event")
                    data = msg.get("data") or {}
                    logger.info("[%s][stdout] event=%s data=%s", agent_id, event, str(data)[:200])
                    if self._on_event:
                        self._on_event(agent_id, event, data)
                    # agent-rpc 在 confirmation_request 后会阻塞等待 stdin 输入
                    # 格式: {"method": "confirm", "params": {"approved": true}}
                    if event == "confirmation_request":
                        await self._send_confirm(agent_id, approved=True)
                    if event == "tool_result":
                        tool_name = data.get("name", "")
                        if tool_name not in ("update_task_plan",):
                            stats = self._tool_stats.setdefault(agent_id, {"total": 0, "failed": 0})
                            stats["total"] += 1
                            if data.get("is_error"):
                                stats["failed"] += 1
                            # ── P2-9: 单任务步骤上限 ────────────────────────
                            if stats["total"] >= self._max_tool_calls and agent_id not in self._tool_limit_exceeded:
                                self._tool_limit_exceeded.add(agent_id)
                                self._tool_stats.pop(agent_id, None)
                                logger.warning(
                                    "[%s] max_tool_calls=%d reached — forcing task failure",
                                    agent_id, self._max_tool_calls,
                                )
                                if self._on_task_done:
                                    await self._on_task_done(
                                        agent_id, False,
                                        {"message": f"max_tool_calls ({self._max_tool_calls}) exceeded", "task_completed": False},
                                    )
                                # 优化：立即软重启，终止子进程，避免继续浪费 token 跑完剩余迭代
                                asyncio.create_task(self._soft_restart_for_memory(agent_id))
                    elif event == "done":
                        # ── P2-9: 步骤超限已提前处理，跳过此 done ──────────
                        if agent_id in self._tool_limit_exceeded:
                            self._tool_limit_exceeded.discard(agent_id)
                            self._tool_stats.pop(agent_id, None)
                            logger.info("[%s] done event ignored — already force-failed (tool limit)", agent_id)
                            continue
                        # 两阶段：若在等待预览响应，则完成 Future，不触发 on_task_done
                        if agent_id in self._pending_preview:
                            fut = self._pending_preview.pop(agent_id)
                            response = data.get("response", "")
                            if not fut.done():
                                fut.set_result(response)
                            self._tool_stats.pop(agent_id, None)  # 预览不计入 tool 统计
                            continue
                        success = data.get("task_completed", False)
                        stats = self._tool_stats.pop(agent_id, {"total": 0, "failed": 0})
                        if success and stats["total"] > 0 and stats["failed"] >= stats["total"]:
                            logger.info("[%s] overriding task_completed: all %d tool calls failed", agent_id, stats["total"])
                            success = False
                        if self._on_task_done:
                            await self._on_task_done(agent_id, success, data)
                        # ── 内存管理：任务完成计数，达阈值触发软重启 ──────────
                        if success:
                            count = self._task_done_counts.get(agent_id, 0) + 1
                            self._task_done_counts[agent_id] = count
                            if count >= _TASKS_PER_SOFT_RESTART:
                                logger.info(
                                    "[%s] task_done_count=%d >= %d — scheduling soft restart "
                                    "to reclaim LLM message memory",
                                    agent_id, count, _TASKS_PER_SOFT_RESTART,
                                )
                                asyncio.create_task(self._soft_restart_for_memory(agent_id))
                    elif event == "error":
                        # ── P2-9: 步骤超限已提前处理，跳过此 error ─────────
                        if agent_id in self._tool_limit_exceeded:
                            self._tool_limit_exceeded.discard(agent_id)
                            self._tool_stats.pop(agent_id, None)
                            logger.info("[%s] error event ignored — already force-failed (tool limit)", agent_id)
                            continue
                        # 两阶段：若在等待预览，完成 Future 并传递空响应（视为拒绝）
                        if agent_id in self._pending_preview:
                            fut = self._pending_preview.pop(agent_id)
                            if not fut.done():
                                fut.set_result("")
                            continue
                        logger.error("[%s][stdout] error event: %s", agent_id, data.get("message", ""))
                        if self._on_task_done:
                            await self._on_task_done(agent_id, False, data)
                except json.JSONDecodeError:
                    logger.warning("[%s][stdout] non-JSON line: %s", agent_id, decoded[:200])

            # ── 进程退出：持久化未完成任务的执行明细（全量监控） ─────────────────
            if eof_received and self._on_process_exit:
                try:
                    self._on_process_exit(agent_id)
                except Exception as exc:
                    logger.warning("[%s] on_process_exit failed: %s", agent_id, exc)

            # ── 自动重启（指数退避 / 计划软重启快速路径） ──────────────────────
            # 仅在 EOF 触发（非 kill() / CancelledError），且 agent 仍在 respawn 注册表中
            if eof_received and agent_id in self._respawn_soul_types:
                soul_type = self._respawn_soul_types[agent_id]

                # ★ 计划内软重启（内存清理或看门狗触发）：1 s 延迟，不累计崩溃次数
                if agent_id in self._planned_restart:
                    self._planned_restart.discard(agent_id)
                    logger.info("[%s] planned soft restart — respawning in 1 s", agent_id)
                    await asyncio.sleep(1.0)
                    if agent_id in self._respawn_soul_types:
                        try:
                            await self.spawn(agent_id, soul_type=soul_type)
                            logger.info("[%s] soft restart complete", agent_id)
                        except Exception as exc:
                            logger.error("[%s] soft restart spawn failed: %s", agent_id, exc)
                            self._respawn_soul_types.pop(agent_id, None)
                    else:
                        logger.info("[%s] kill() called during soft restart — cancelled", agent_id)
                else:
                    # 意外崩溃：指数退避
                    spawn_time = self._spawn_times.get(agent_id, 0.0)
                    uptime = asyncio.get_event_loop().time() - spawn_time
                    # 稳定运行 >60s 视为正常退出后崩溃，重置退避计数
                    if uptime > 60.0:
                        self._crash_counts.pop(agent_id, None)
                    crash_count = self._crash_counts.get(agent_id, 0)
                    self._crash_counts[agent_id] = crash_count + 1
                    # 5s → 10s → 20s → 40s → 80s → 120s（上限）
                    backoff = min(5.0 * (2 ** crash_count), 120.0)
                    logger.warning(
                        "[%s] process exited unexpectedly (uptime=%.0fs, crash #%d), "
                        "respawning in %.0fs...",
                        agent_id, uptime, crash_count + 1, backoff,
                    )
                    await asyncio.sleep(backoff)
                    # 再次检查：backoff 期间可能被 kill()
                    if agent_id in self._respawn_soul_types:
                        logger.info("[%s] respawning (soul_type=%s)...", agent_id, soul_type)
                        try:
                            await self.spawn(agent_id, soul_type=soul_type)
                            logger.info("[%s] respawn complete", agent_id)
                        except Exception as exc:
                            logger.error("[%s] respawn failed, giving up: %s", agent_id, exc)
                            self._respawn_soul_types.pop(agent_id, None)
                    else:
                        logger.info("[%s] kill() called during backoff — respawn cancelled", agent_id)

        except (asyncio.CancelledError, ConnectionResetError):
            pass

    async def _drain_stream(
        self, agent_id: str, stream: Optional[asyncio.StreamReader], name: str
    ) -> None:
        """消费 stderr，记录日志（不丢弃）"""
        if stream is None:
            return
        try:
            while agent_id in self._processes:
                line = await stream.readline()
                if not line:
                    break
                decoded = line.decode("utf-8", errors="ignore").strip()
                if decoded:
                    logger.warning("[%s][%s] %s", agent_id, name, decoded)
        except (asyncio.CancelledError, ConnectionResetError):
            pass

    async def kill(self, agent_id: str) -> None:
        """停止并清理（删除 respawn 注册，确保不会自动重启）"""
        # ★ 先取消 respawn 注册，再 terminate 进程；
        #   这样 _drain_stdout 收到 EOF 后检查到注册已清除，不会触发重启
        self._respawn_soul_types.pop(agent_id, None)
        self._crash_counts.pop(agent_id, None)
        self._spawn_times.pop(agent_id, None)
        self._agent_homes.pop(agent_id, None)
        self._tool_stats.pop(agent_id, None)
        self._tool_limit_exceeded.discard(agent_id)
        self._task_done_counts.pop(agent_id, None)
        self._planned_restart.discard(agent_id)
        if agent_id in self._pending_preview:
            fut = self._pending_preview.pop(agent_id)
            if not fut.done():
                fut.set_result("")
        if agent_id in self._processes:
            proc = self._processes.pop(agent_id)
            try:
                proc.terminate()
                await asyncio.wait_for(proc.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
            except ProcessLookupError:
                pass

    async def _soft_restart_for_memory(self, agent_id: str) -> None:
        """受控软重启：通过 terminate() 让 _drain_stdout 走计划重启快速路径（1 s 延迟，不累计崩溃次数）。

        调用前提：agent 仍在 _respawn_soul_types（即自动重启已注册）。
        _drain_stdout 收到 EOF 后检测到 _planned_restart 标志，跳过指数退避直接重新 spawn。
        """
        if agent_id not in self._processes:
            return
        proc = self._processes.get(agent_id)
        if proc is None or proc.returncode is not None:
            return
        logger.info("[%s] _soft_restart_for_memory: marking planned restart and terminating", agent_id)
        self._planned_restart.add(agent_id)
        try:
            proc.terminate()
        except ProcessLookupError:
            self._planned_restart.discard(agent_id)

    def _start_memory_watchdog(self) -> None:
        """启动内存看门狗后台任务"""
        if self._memory_watchdog_task is not None and not self._memory_watchdog_task.done():
            return
        self._memory_watchdog_task = asyncio.create_task(self._memory_watchdog_loop())

    async def _memory_watchdog_loop(self) -> None:
        """内存看门狗：定期检查子进程内存使用，超阈值触发软重启"""
        # 优先使用 psutil（更高效），回退到 ps 命令
        _psutil = None
        try:
            import psutil as _psutil
        except ImportError:
            logger.warning("[watchdog] psutil not installed, using ps command (less efficient)")
            _psutil = None

        logger.info(
            "memory watchdog started: interval=%ds, threshold=%dMB (psutil=%s)",
            _MEMORY_WATCHDOG_INTERVAL_SEC, _MEMORY_WATCHDOG_THRESHOLD_MB, _psutil is not None
        )
        while True:
            try:
                await asyncio.sleep(_MEMORY_WATCHDOG_INTERVAL_SEC)
            except asyncio.CancelledError:
                break

            # 检查每个 agent 进程的内存使用
            for agent_id in list(self._processes.keys()):
                if agent_id not in self._respawn_soul_types:
                    continue  # 不应自动重启的进程，跳过

                proc = self._processes.get(agent_id)
                if proc is None or proc.returncode is not None:
                    continue

                try:
                    memory_mb = await self._get_process_memory_mb(proc.pid, _psutil)
                    if memory_mb > _MEMORY_WATCHDOG_THRESHOLD_MB:
                        logger.warning(
                            "[%s] memory usage %dMB exceeds threshold %dMB — scheduling soft restart",
                            agent_id, memory_mb, _MEMORY_WATCHDOG_THRESHOLD_MB
                        )
                        await self._soft_restart_for_memory(agent_id)
                except Exception as e:
                    logger.debug("[%s] failed to get process memory: %s", agent_id, e)

    async def _get_process_memory_mb(self, pid: int, _psutil: Any = None) -> float:
        """获取进程内存使用（MB），优先使用 psutil"""
        # 方式1: 使用 psutil（更高效）
        if _psutil is not None:
            try:
                proc = _psutil.Process(pid)
                return proc.memory_info().rss / (1024 * 1024)  # bytes -> MB
            except (_psutil.NoSuchProcess, _psutil.AccessDenied):
                return 0.0

        # 方式2: 回退到 ps 命令
        try:
            result = await asyncio.create_subprocess_exec(
                "ps", "-o", "rss=", "-p", str(pid),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await result.communicate()
            if result.returncode == 0 and stdout:
                rss_kb = int(stdout.decode().strip())
                return rss_kb / 1024  # KB -> MB
        except (FileNotFoundError, ValueError, ProcessLookupError):
            pass
        return 0.0

    async def stop_memory_watchdog(self) -> None:
        """停止内存看门狗"""
        if self._memory_watchdog_task is not None:
            self._memory_watchdog_task.cancel()
            try:
                await self._memory_watchdog_task
            except asyncio.CancelledError:
                pass
            self._memory_watchdog_task = None
            logger.info("memory watchdog stopped")

    async def preview_task(
        self,
        agent_id: str,
        task: str,
        *,
        context: Optional[dict] = None,
    ) -> tuple[bool, str]:
        """两阶段 Phase 1：发送任务预览，等待 agent 返回 ACCEPT/REFUSE。

        返回 (accepted: bool, response: str)。
        超时或错误时返回 (False, "")。
        """
        if agent_id not in self._processes:
            return False, ""
        proc = self._processes[agent_id]
        if proc.returncode is not None or proc.stdin is None:
            return False, ""

        preview_msg = f"""【任务预览】{task.strip()}

## 当前阶段：决策阶段
你只需要判断是否接受此任务，**不要执行任务**，**不要给出答案**。

## 输出格式
请严格按以下格式输出：
```
ACCEPT
理由：<简要说明为什么接受/拒绝，1-2句话>
```
或
```
REFUSE
理由：<简要说明为什么拒绝>
```
不要输出其他内容，不要调用任何工具。"""
        fut: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._pending_preview[agent_id] = fut

        agent_home = self._agent_homes.get(agent_id)
        skill_dirs = [str(Path(agent_home) / ".skills")] if agent_home else []
        soul_path_str = str(Path(agent_home) / "SOUL.md") if agent_home else None
        import time
        preview_session = f"{agent_id}_preview_{int(time.time())}"
        params: dict = {
            "message": preview_msg,
            "session_key": preview_session,
            "skill_dirs": skill_dirs,
            "config": {
                "workspace": agent_home,
                "soul_path": soul_path_str,
                "skip_history_for_planning": True,
                "enable_task_planning": False,
                "max_iterations": 50,
            },
        }
        if context and context.get("append"):
            params["context"] = {"append": context["append"]}
        req = {"method": "agent_chat", "params": params}
        try:
            proc.stdin.write((json.dumps(req) + "\n").encode())
            await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as e:
            logger.warning("[%s] preview_task write failed: %s", agent_id, e)
            self._pending_preview.pop(agent_id, None)
            return False, ""

        try:
            response = await asyncio.wait_for(fut, timeout=PREVIEW_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            logger.warning("[%s] preview_task timeout after %ds", agent_id, PREVIEW_TIMEOUT_SEC)
            self._pending_preview.pop(agent_id, None)
            return False, ""
        except asyncio.CancelledError:
            self._pending_preview.pop(agent_id, None)
            raise

        # 解析：REFUSE/拒绝 -> 拒绝；否则视为接受
        # ★ 先剥离 <think>…</think> 推理块，避免推理文本中的"拒绝"/"REFUSE"触发误判
        clean = _strip_think_blocks(response or "")
        clean_upper = clean.upper()
        if "REFUSE" in clean_upper or "拒绝" in clean:
            logger.info("[%s] preview REFUSED: %s", agent_id, clean[:120])
            return False, response
        logger.info("[%s] preview ACCEPTED: %s", agent_id, clean[:120])
        return True, response

    async def _send_confirm(self, agent_id: str, approved: bool) -> None:
        """向 agent stdin 发送确认响应，解除 confirmation_request 的阻塞"""
        if agent_id not in self._processes:
            return
        proc = self._processes[agent_id]
        if proc.stdin is None:
            return
        try:
            payload = json.dumps({"method": "confirm", "params": {"approved": approved}}) + "\n"
            proc.stdin.write(payload.encode())
            await proc.stdin.drain()
            logger.info("[%s] sent confirm approved=%s", agent_id, approved)
        except (BrokenPipeError, ConnectionResetError) as e:
            logger.warning("[%s] _send_confirm failed: %s", agent_id, e)

    async def inject_task(
        self,
        agent_id: str,
        task: str,
        *,
        context: Optional[dict] = None,
    ) -> bool:
        """向 stdin 注入任务（agent-rpc JSON-RPC 格式），使用该 agent 独立的 skill_dirs。

        context: 可选，如 {"append": "..."} 会通过 RPC params.context.append 注入到 agent 的 system prompt。
        """
        if agent_id not in self._processes:
            logger.error(
                "[%s] inject_task FAILED: agent not in processes. Known: %s",
                agent_id, list(self._processes.keys()),
            )
            return False
        proc = self._processes[agent_id]
        if proc.returncode is not None:
            logger.error(
                "[%s] inject_task FAILED: process already exited with code %s",
                agent_id, proc.returncode,
            )
            self._processes.pop(agent_id, None)
            return False
        if proc.stdin is None:
            logger.error("[%s] inject_task FAILED: proc.stdin is None", agent_id)
            return False
        agent_home = self._agent_homes.get(agent_id)
        skill_dirs = [str(Path(agent_home) / ".skills")] if agent_home else []
        try:
            soul_path_str = str(Path(agent_home) / "SOUL.md") if agent_home else None
            params: dict = {
                "message": f"【执行任务】{task.strip()}\n\n请执行此任务，完成后输出结果。",
                "session_key": agent_id,
                "skill_dirs": skill_dirs,
                "config": {
                    "workspace": agent_home,
                    "soul_path": soul_path_str,
                    "skip_history_for_planning": True,
                },
            }
            if context and context.get("append"):
                params["context"] = {"append": context["append"]}
            req = {"method": "agent_chat", "params": params}
            payload = json.dumps(req) + "\n"
            logger.info("[%s] inject_task sending %d bytes: %s", agent_id, len(payload), payload[:120])
            proc.stdin.write(payload.encode())
            await proc.stdin.drain()
            logger.info("[%s] inject_task drain complete", agent_id)
            return True
        except (BrokenPipeError, ConnectionResetError) as e:
            logger.error("[%s] inject_task FAILED to write stdin: %s", agent_id, e)
            return False

    def repair_skills(self, agent_home: str, skill_names: list[str] | None = None) -> tuple[bool, str]:
        """调用 skilllite evolution repair-skills 修复 agent 的 .skills 目录中的技能。

        不覆盖、不同步 arena_skills；仅对 agent 已有的技能做测试，失败时由 LLM 修复。
        skill_names: 若非空则仅验证/修复这些技能，缩短执行时间；空或 None 则修复全部失败技能。
        """
        # 防御：若误传 chat_dir（以 /chat 结尾），修正为 agent_home
        if agent_home.rstrip("/").endswith("/chat"):
            fixed = str(Path(agent_home).parent)
            logger.warning(
                "repair_skills: agent_home ends with /chat, fixing %s -> %s",
                agent_home, fixed,
            )
            agent_home = fixed
        evolve_env = {**os.environ}
        if evolve_env.get("API_KEY"):
            evolve_env["OPENAI_API_KEY"] = evolve_env["API_KEY"]
            evolve_env["SKILLLITE_API_KEY"] = evolve_env["API_KEY"]
        if evolve_env.get("BASE_URL"):
            evolve_env["OPENAI_BASE_URL"] = evolve_env["BASE_URL"]
            evolve_env["SKILLLITE_API_BASE"] = evolve_env["BASE_URL"]
        if evolve_env.get("MODEL"):
            evolve_env["OPENAI_MODEL"] = evolve_env["MODEL"]
            evolve_env["SKILLLITE_MODEL"] = evolve_env["MODEL"]
        evolve_env["SKILLLITE_WORKSPACE"] = agent_home
        cmd = ["skilllite", "evolution", "repair-skills"]
        if skill_names:
            cmd.extend(skill_names)
        try:
            result = subprocess.run(
                cmd,
                env=evolve_env,
                cwd=agent_home,
                capture_output=True,
                timeout=300,
                text=True,
            )
            out = (result.stdout or "") + (result.stderr or "")
            ok = result.returncode == 0
            msg = out.strip() if out else ("修复完成" if ok else "修复失败")
            logger.info("[%s] repair_skills: %s", agent_home, msg[:300])
            return ok, msg
        except subprocess.TimeoutExpired:
            return False, "skilllite repair-skills 超时"
        except FileNotFoundError:
            return False, "skilllite 未找到，请确保已安装"
        except Exception as e:
            return False, str(e)[:200]

    async def repair_skills_stream(self, agent_home: str, skill_names: list[str] | None = None) -> AsyncIterator[str]:
        """流式执行 skilllite repair-skills，逐行 yield 输出，便于前端展示进度。
        skill_names: 若非空则仅验证/修复这些技能；空或 None 则修复全部失败技能。
        """
        if agent_home.rstrip("/").endswith("/chat"):
            agent_home = str(Path(agent_home).parent)
        evolve_env = {**os.environ}
        if evolve_env.get("API_KEY"):
            evolve_env["OPENAI_API_KEY"] = evolve_env["API_KEY"]
            evolve_env["SKILLLITE_API_KEY"] = evolve_env["API_KEY"]
        if evolve_env.get("BASE_URL"):
            evolve_env["OPENAI_BASE_URL"] = evolve_env["BASE_URL"]
            evolve_env["SKILLLITE_API_BASE"] = evolve_env["BASE_URL"]
        if evolve_env.get("MODEL"):
            evolve_env["OPENAI_MODEL"] = evolve_env["MODEL"]
            evolve_env["SKILLLITE_MODEL"] = evolve_env["MODEL"]
        evolve_env["SKILLLITE_WORKSPACE"] = agent_home
        cmd: list[str] = ["skilllite", "evolution", "repair-skills"]
        if skill_names:
            cmd.extend(skill_names)
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                env=evolve_env,
                cwd=agent_home,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            buf = b""
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, _, buf = buf.partition(b"\n")
                    if line:
                        try:
                            yield json.dumps({"t": "log", "m": line.decode("utf-8", errors="replace").rstrip()})
                        except Exception:
                            pass
            if buf:
                try:
                    yield json.dumps({"t": "log", "m": buf.decode("utf-8", errors="replace").rstrip()})
                except Exception:
                    pass
            ret = await proc.wait()
            yield json.dumps({"t": "done", "ok": ret == 0})
        except FileNotFoundError:
            yield json.dumps({"t": "done", "ok": False, "error": "skilllite 未找到，请确保已安装"})
        except asyncio.TimeoutError:
            yield json.dumps({"t": "done", "ok": False, "error": "修复超时"})
        except Exception as e:
            yield json.dumps({"t": "done", "ok": False, "error": str(e)[:200]})

    async def trigger_evolve(
        self,
        agent_id: str,
        agent_home: str,
        evolution_division: str = "all",
    ) -> tuple[bool, str]:
        """主动触发进化: skilllite evolution run，使用该 agent 独立的 .skills。
        evolution_division 仅用于身份/展示（进化方向），不限制进化模块：始终允许规则+技能+记忆全量进化。
        返回 (成功与否, 输出信息供前端展示)
        """
        # ★ 防御检查：agent_home 不应以 /chat 结尾（chat_dir 误传），且路径中应包含 agent_id
        if agent_home.rstrip("/").endswith("/chat"):
            fixed = str(Path(agent_home).parent)
            logger.warning(
                "[%s] trigger_evolve: agent_home ends with /chat, fixing %s -> %s",
                agent_id, agent_home, fixed,
            )
            agent_home = fixed
        if agent_id not in agent_home:
            logger.warning(
                "[%s] trigger_evolve: agent_id not found in agent_home=%s — possible mismatch!",
                agent_id, agent_home,
            )
        logger.info(
            "[%s] trigger_evolve: agent_home=%s, evolution_direction=%s (no module limit)",
            agent_id, agent_home, evolution_division,
        )
        evolve_env = {**os.environ}
        if evolve_env.get("API_KEY"):
            evolve_env["OPENAI_API_KEY"] = evolve_env["API_KEY"]
            evolve_env["SKILLLITE_API_KEY"] = evolve_env["API_KEY"]
        if evolve_env.get("BASE_URL"):
            evolve_env["OPENAI_BASE_URL"] = evolve_env["BASE_URL"]
            evolve_env["SKILLLITE_API_BASE"] = evolve_env["BASE_URL"]
        if evolve_env.get("MODEL"):
            evolve_env["OPENAI_MODEL"] = evolve_env["MODEL"]
            evolve_env["SKILLLITE_MODEL"] = evolve_env["MODEL"]
        evolve_env["SKILLLITE_WORKSPACE"] = agent_home
        # 进化模块不限制：始终全量进化（进化方向仅作身份/展示用）
        evolve_env["SKILLLITE_EVOLUTION"] = "1"
        proc = await asyncio.create_subprocess_exec(
            "skilllite",
            "evolution",
            "run",
            env=evolve_env,
            cwd=agent_home,  # 确保 resolve_skills_root 正确
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await proc.communicate()
        out = (stdout or b"").decode("utf-8", errors="replace").strip()
        if proc.returncode != 0:
            logger.warning("[%s] evolution run failed (code=%s): %s", agent_id, proc.returncode, out[:500])
        elif out:
            logger.info("[%s] evolution: %s", agent_id, out[:300])
        ok = proc.returncode == 0
        return ok, out
