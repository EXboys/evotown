"""SkillLite 进程生命周期管理
每个角色 = 一个独立 SkillLite 子进程，独立 chat_dir + 独立 skills
通过 HOME 环境变量实现多 Agent 数据隔离：HOME=agent_home 时 ~/.skilllite/chat → agent_home/.skilllite/chat
"""
import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Awaitable, Callable, Optional

# 每个 agent 的 agent_home 下：.skilllite/chat（数据）、.skills（技能，独立进化）


class ProcessManager:
    """管理多个 SkillLite 子进程"""

    def __init__(self) -> None:
        self._processes: dict[str, asyncio.subprocess.Process] = {}
        self._agent_homes: dict[str, str] = {}  # agent_id -> agent_home
        self._arena_root = Path.home() / ".skilllite" / "arena"
        self._on_task_done: Optional[Callable[[str, bool], Awaitable[None]]] = None

    def set_on_task_done(self, cb: Callable[[str, bool], Awaitable[None]]) -> None:
        """设置任务完成回调：on_task_done(agent_id, success)"""
        self._on_task_done = cb

    def _agent_home(self, agent_id: str, custom_dir: Optional[str] = None) -> Path:
        """Agent 的 HOME 目录（用于 subprocess env）"""
        if custom_dir:
            return Path(custom_dir).resolve()
        return self._arena_root / agent_id

    def _chat_root(self, agent_home: Path) -> Path:
        """chat_root = agent_home/.skilllite/chat"""
        return agent_home / ".skilllite" / "chat"

    def _ensure_agent_structure(self, agent_home: Path) -> Path:
        """创建 agent_home/.skilllite/chat 结构，并初始化 agent_home/.skills（独立技能目录）"""
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

        # 初始化 seed（若 prompts 为空）
        prompts_dir = chat_root / "prompts"
        rules_file = prompts_dir / "rules.json"
        if not rules_file.exists():
            # 运行 skilllite evolution run 初始化（会 ensure_seed_data）
            proc = await asyncio.create_subprocess_exec(
                "skilllite",
                "evolution",
                "run",
                env={**os.environ, "HOME": str(agent_home)},
                cwd=os.getcwd(),  # 需要 workspace 有 .skills
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()
            # 若失败（如无 .skills），仍创建空结构，后续可手动初始化

        # 启动 skilllite agent-rpc 子进程（JSON-RPC over stdio，适合程序化任务注入）
        proc = await asyncio.create_subprocess_exec(
            "skilllite",
            "agent-rpc",
            env={**os.environ, "HOME": str(agent_home)},
            cwd=os.getcwd(),
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
                    break
                line = line.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    event = msg.get("event")
                    data = msg.get("data") or {}
                    if event == "done":
                        success = data.get("task_completed", False)
                        if self._on_task_done:
                            await self._on_task_done(agent_id, success)
                    elif event == "error":
                        if self._on_task_done:
                            await self._on_task_done(agent_id, False)
                except json.JSONDecodeError:
                    pass
        except (asyncio.CancelledError, ConnectionResetError):
            pass

    async def _drain_stream(
        self, agent_id: str, stream: Optional[asyncio.StreamReader], name: str
    ) -> None:
        """消费 stderr，防止管道满"""
        if stream is None:
            return
        try:
            while agent_id in self._processes:
                line = await stream.readline()
                if not line:
                    break
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

    async def inject_task(self, agent_id: str, task: str) -> bool:
        """向 stdin 注入任务（agent-rpc JSON-RPC 格式），使用该 agent 独立的 skill_dirs"""
        if agent_id not in self._processes:
            return False
        proc = self._processes[agent_id]
        if proc.stdin is None:
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
                },
            }
            proc.stdin.write((json.dumps(req) + "\n").encode())
            await proc.stdin.drain()
            return True
        except (BrokenPipeError, ConnectionResetError):
            return False

    async def trigger_evolve(self, agent_id: str, agent_home: str) -> bool:
        """主动触发进化: skilllite evolution run，使用该 agent 独立的 .skills"""
        proc = await asyncio.create_subprocess_exec(
            "skilllite",
            "evolution",
            "run",
            env={
                **os.environ,
                "HOME": agent_home,
                "SKILLLITE_WORKSPACE": agent_home,  # 进化写入 agent_home/.skills/_evolved
            },
            cwd=os.getcwd(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0 and stderr:
            # 记录但不失败（可能是无新样本等）
            pass
        return proc.returncode == 0
