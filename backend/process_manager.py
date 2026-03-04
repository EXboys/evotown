"""SkillLite 进程生命周期管理
每个角色 = 一个独立 SkillLite 子进程，独立 chat_dir + 独立 skills
通过 SKILLLITE_WORKSPACE 环境变量实现多 Agent 数据隔离：每个 agent 的数据在 agent_home/ 下
"""
import asyncio
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Awaitable, Callable, Optional

logger = logging.getLogger("evotown.process")

# 预览请求超时（秒）
PREVIEW_TIMEOUT_SEC = 60

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
        self._arena_root = Path.home() / ".skilllite" / "arena"
        self._on_task_done: Optional[Callable[[str, bool, dict], Awaitable[None]]] = None
        self._on_event: Optional[Callable[[str, str, dict], None]] = None
        # per-agent tool call tracking for task completion validation
        self._tool_stats: dict[str, dict[str, int]] = {}
        # 两阶段：等待预览响应的 Future，agent_id -> Future[str]
        self._pending_preview: dict[str, asyncio.Future[str]] = {}

    def set_on_task_done(self, cb: Callable[[str, bool, dict], Awaitable[None]]) -> None:
        """设置任务完成回调：on_task_done(agent_id, success, done_data)"""
        self._on_task_done = cb

    def set_on_event(self, cb: Callable[[str, str, dict], None]) -> None:
        """设置事件回调：on_event(agent_id, event, data) — 供监控模块使用"""
        self._on_event = cb

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
                shutil.copytree(workspace_skills, skills_dir, dirs_exist_ok=True)
                logger.info("Seeded agent .skills from %s", workspace_skills.name)
            else:
                # 合并缺失的种子技能（兼容旧 agent）
                for sub in workspace_skills.iterdir():
                    if sub.name.startswith(".") or sub.name in existing:
                        continue
                    if sub.is_dir() and (sub / "SKILL.md").exists():
                        dst = skills_dir / sub.name
                        if not dst.exists():
                            shutil.copytree(sub, dst, dirs_exist_ok=True)
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
        agent_env = {**os.environ}
        # 归一化 API 密钥：支持 API_KEY/BASE_URL/MODEL（本地 .env 惯例）和 OPENAI_* 两种命名
        if not agent_env.get("OPENAI_API_KEY") and agent_env.get("API_KEY"):
            agent_env["OPENAI_API_KEY"] = agent_env["API_KEY"]
        if not agent_env.get("OPENAI_BASE_URL") and agent_env.get("BASE_URL"):
            agent_env["OPENAI_BASE_URL"] = agent_env["BASE_URL"]
        if not agent_env.get("OPENAI_MODEL") and agent_env.get("MODEL"):
            agent_env["OPENAI_MODEL"] = agent_env["MODEL"]
        agent_env["SKILLLITE_WORKSPACE"] = str(agent_home)
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

        # 后台消费 stdout，解析 done/error 事件并回调
        asyncio.create_task(self._drain_stdout(agent_id, proc.stdout))
        asyncio.create_task(self._drain_stream(agent_id, proc.stderr, "stderr"))

        return str(agent_home), str(chat_root)

    async def _drain_stdout(
        self, agent_id: str, stream: Optional[asyncio.StreamReader]
    ) -> None:
        """消费 stdout，解析 agent-rpc JSON-Lines 事件（done/error）并回调"""
        if stream is None:
            return
        try:
            while agent_id in self._processes:
                line = await stream.readline()
                if not line:
                    logger.warning("[%s][stdout] EOF — subprocess exited", agent_id)
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
                    elif event == "done":
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
                    elif event == "error":
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
        """停止并清理"""
        self._agent_homes.pop(agent_id, None)
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

        preview_msg = f"【任务预览】{task.strip()}\n\n请回复 ACCEPT 或 REFUSE，并简要说明理由。不要调用任何工具。"
        fut: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._pending_preview[agent_id] = fut

        agent_home = self._agent_homes.get(agent_id)
        skill_dirs = [str(Path(agent_home) / ".skills")] if agent_home else []
        soul_path_str = str(Path(agent_home) / "SOUL.md") if agent_home else None
        params: dict = {
            "message": preview_msg,
            "session_key": agent_id,
            "skill_dirs": skill_dirs,
            "config": {"workspace": agent_home, "soul_path": soul_path_str},
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
        resp_upper = (response or "").upper()
        if "REFUSE" in resp_upper or "拒绝" in response:
            logger.info("[%s] preview REFUSED: %s", agent_id, (response or "")[:80])
            return False, response
        logger.info("[%s] preview ACCEPTED: %s", agent_id, (response or "")[:80])
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
                "message": task.strip(),
                "session_key": agent_id,
                "skill_dirs": skill_dirs,
                "config": {
                    "workspace": agent_home,
                    "soul_path": soul_path_str,  # 显式指定 agent 根目录 SOUL.md
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

    async def trigger_evolve(self, agent_id: str, agent_home: str) -> tuple[bool, str]:
        """主动触发进化: skilllite evolution run，使用该 agent 独立的 .skills
        返回 (成功与否, 输出信息供前端展示)
        """
        evolve_env = {**os.environ}
        if not evolve_env.get("OPENAI_API_KEY") and evolve_env.get("API_KEY"):
            evolve_env["OPENAI_API_KEY"] = evolve_env["API_KEY"]
        if not evolve_env.get("OPENAI_BASE_URL") and evolve_env.get("BASE_URL"):
            evolve_env["OPENAI_BASE_URL"] = evolve_env["BASE_URL"]
        if not evolve_env.get("OPENAI_MODEL") and evolve_env.get("MODEL"):
            evolve_env["OPENAI_MODEL"] = evolve_env["MODEL"]
        evolve_env["SKILLLITE_WORKSPACE"] = agent_home
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
