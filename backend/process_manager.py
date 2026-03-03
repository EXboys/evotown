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

# 每个 agent 的 agent_home 下：chat/（数据）、.skills/（技能，独立进化）


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

    def _ensure_agent_structure(self, agent_home: Path) -> Path:
        """创建 agent_home/chat 结构，并初始化 agent_home/.skills（独立技能目录）"""
        chat_root = self._chat_root(agent_home)
        chat_root.mkdir(parents=True, exist_ok=True)
        (chat_root / "memory").mkdir(parents=True, exist_ok=True)
        (chat_root / "prompts").mkdir(parents=True, exist_ok=True)
        (chat_root / "transcripts").mkdir(parents=True, exist_ok=True)
        (chat_root / "plans").mkdir(parents=True, exist_ok=True)
        (chat_root / "output").mkdir(parents=True, exist_ok=True)

        # 每个 agent 独立 .skills：从 workspace 复制种子技能，进化产物写入 agent_home/.skills/_evolved
        skills_dir = agent_home / ".skills"
        workspace_skills = Path.cwd() / ".skills"
        if not workspace_skills.exists():
            workspace_skills = Path.cwd() / "skills"
        if not skills_dir.exists() and workspace_skills.exists():
            shutil.copytree(workspace_skills, skills_dir, dirs_exist_ok=True)
        elif not skills_dir.exists():
            skills_dir.mkdir(parents=True, exist_ok=True)

        return chat_root

    async def spawn(
        self, agent_id: str, chat_dir: Optional[str] = None
    ) -> tuple[str, str]:
        """启动指定 Agent 的 SkillLite 进程（或仅创建目录结构）
        返回 (agent_home, chat_root) 路径字符串
        """
        agent_home = self._agent_home(agent_id, chat_dir)
        self._arena_root.mkdir(parents=True, exist_ok=True)
        chat_root = self._ensure_agent_structure(agent_home)

        # 启动 skilllite agent-rpc 子进程（仅设 SKILLLITE_WORKSPACE，不覆盖 HOME）
        agent_env = {
            **os.environ,
            "SKILLLITE_WORKSPACE": str(agent_home),
        }
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
                        success = data.get("task_completed", False)
                        stats = self._tool_stats.pop(agent_id, {"total": 0, "failed": 0})
                        if success and stats["total"] > 0 and stats["failed"] >= stats["total"]:
                            logger.info("[%s] overriding task_completed: all %d tool calls failed", agent_id, stats["total"])
                            success = False
                        if self._on_task_done:
                            await self._on_task_done(agent_id, success, data)
                    elif event == "error":
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

    async def inject_task(self, agent_id: str, task: str) -> bool:
        """向 stdin 注入任务（agent-rpc JSON-RPC 格式），使用该 agent 独立的 skill_dirs"""
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
            req = {
                "method": "agent_chat",
                "params": {
                    "message": task.strip(),
                    "session_key": agent_id,
                    "skill_dirs": skill_dirs,
                    "config": {
                        "workspace": agent_home,  # 确保 ChatSession 写入正确的 agent 目录
                    },
                },
            }
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
        proc = await asyncio.create_subprocess_exec(
            "skilllite",
            "evolution",
            "run",
            env={
                **os.environ,
                "SKILLLITE_WORKSPACE": agent_home,
            },
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
