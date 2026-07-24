"""Claude Code runner — 实现 AgentRunner 统一接口。

单个 runner 内部分流 SDK / CLI / dry-run 三种 backend。
模块级函数 gateway_sdk_env() 供 claude_code_runner CLI 子进程路径使用。
"""
from __future__ import annotations

import asyncio
import json
import os
import shlex
import shutil
from pathlib import Path
from typing import Any, Callable

from services.agent_runner_base import AgentRunContext, AgentRunResult

_SDK_IMPORT_ERROR: str | None = None


def sdk_available() -> bool:
    """Return True when claude-agent-sdk is importable."""
    global _SDK_IMPORT_ERROR
    try:
        import claude_agent_sdk  # noqa: F401
    except ImportError as exc:
        _SDK_IMPORT_ERROR = str(exc)
        return False
    _SDK_IMPORT_ERROR = None
    return True


def sdk_import_error() -> str | None:
    sdk_available()
    return _SDK_IMPORT_ERROR


def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def gateway_sdk_env(*, agent_id: str = "") -> dict[str, str]:
    """Gateway env injected into Claude SDK/CLI subprocess."""
    if not _truthy_env("EVOTOWN_CLAUDE_USE_GATEWAY"):
        return {}
    base_url = os.environ.get("EVOTOWN_CLAUDE_GATEWAY_BASE_URL", "").strip().rstrip("/")
    api_key = ""
    if agent_id:
        from infra import agents
        api_key = agents.get_agent_key(agent_id)
    if not api_key:
        api_key = os.environ.get("EVOTOWN_CLAUDE_GATEWAY_API_KEY", "").strip()
    env: dict[str, str] = {
        "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST": "1",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0",
        "CLAUDE_CODE_SIMPLE": "1",
    }
    if base_url:
        env["ANTHROPIC_BASE_URL"] = base_url
    if api_key:
        env["ANTHROPIC_API_KEY"] = api_key
    return env


# ── Runner 实现 ────────────────────────────────────────────────────


class ClaudeCodeRunner:
    """Claude Code runner — 实现 AgentRunner Protocol。

    Backend 决策（优先级：环境变量 > 自动检测）:
    - SDK 可用 → "sdk"
    - CLI 可用   → "cli"
    - 都不可用   → "dry-run"
    """

    engine = "claude"

    # ── Protocol ──

    def is_available(self) -> bool:
        return sdk_available() or bool(self._default_claude_command())

    def resolve_backend(self) -> str:
        mode = os.environ.get("EVOTOWN_CLAUDE_EXECUTION_MODE", "auto").strip().lower()
        if mode in ("dry-run", "dry_run"):
            return "dry-run"
        if mode == "sdk":
            return "sdk" if sdk_available() else "dry-run"
        if mode == "cli":
            return "cli" if self._command_template() else "dry-run"
        # auto: SDK > CLI > dry-run
        if sdk_available():
            return "sdk"
        if self._command_template():
            return "cli"
        return "dry-run"

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
        backend = self.resolve_backend()
        if backend == "sdk":
            return await self._run_sdk(
                workspace_root=workspace_root,
                prompt=prompt,
                model=model,
                context=context,
                on_message=on_message,
            )
        if backend == "cli":
            return await self._run_cli(
                workspace_root=workspace_root,
                prompt=prompt,
                model=model,
                context=context,
                on_message=on_message,
            )
        # dry-run
        return AgentRunResult(
            exit_code=0,
            output=(
                "Dry-run completed. Install claude-agent-sdk (pip install claude-agent-sdk) "
                "and set ANTHROPIC_API_KEY, enable EVOTOWN_CLAUDE_USE_GATEWAY with "
                "EVOTOWN_CLAUDE_GATEWAY_API_KEY, or configure EVOTOWN_CLAUDE_CODE_COMMAND "
                "for CLI execution. Workspace context files were written under .evotown/."
            ),
            raw_output="",
        )

    # ── SDK backend ──

    async def _run_sdk(
        self,
        *,
        workspace_root: Path,
        prompt: str,
        model: str,
        context: AgentRunContext,
        on_message: Callable[[str], None] | None = None,
    ) -> AgentRunResult:
        from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ResultMessage, query

        permission_mode = os.environ.get("EVOTOWN_CLAUDE_PERMISSION_MODE", "acceptEdits").strip() or "acceptEdits"

        options_kwargs: dict[str, Any] = {
            "cwd": workspace_root,
            "model": model or None,
            "permission_mode": permission_mode,
            "allowed_tools": self._allowed_tools(),
            "mcp_servers": self._mcp_servers(workspace_root),
            "setting_sources": ["project"],
            "env": {
                **gateway_sdk_env(agent_id=context.agent_id),
                "EVOTOWN_AGENT_RUN_ID": context.run_id,
                "EVOTOWN_WORKSPACE_ROOT": str(workspace_root),
                "EVOTOWN_CLAUDE_MODEL": model,
            },
        }

        # Resume previous Claude session (native context management)
        if context.resume_session_id:
            options_kwargs["resume"] = context.resume_session_id

        system_prompt = self._system_prompt(workspace_root)
        if system_prompt is not None:
            options_kwargs["system_prompt"] = system_prompt

        max_turns = self._max_turns()
        if max_turns is not None:
            options_kwargs["max_turns"] = max_turns

        options = ClaudeAgentOptions(**options_kwargs)

        log_lines: list[str] = []
        exit_code = 1
        claude_session_id = ""
        _emitted_texts: set[str] = set()

        def _emit(text: str) -> None:
            stripped = text.strip()
            if not stripped:
                return
            if stripped in _emitted_texts:
                return
            _emitted_texts.add(stripped)
            log_lines.append(text)
            if on_message:
                on_message(text)

        async def _query():
            nonlocal exit_code, claude_session_id
            async for message in query(prompt=prompt, options=options):
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        text = getattr(block, "text", None)
                        if text:
                            _emit(str(text))
                elif isinstance(message, ResultMessage):
                    if getattr(message, "errors", None):
                        for item in message.errors:
                            _emit(str(item))
                    if message.subtype == "success" and not message.is_error:
                        exit_code = 0
                    else:
                        exit_code = 1
                    claude_session_id = getattr(message, "session_id", "") or ""

        # Try resume first; if stale/broken, silently fall back to fresh session
        try:
            await _query()
        except Exception:
            if context.resume_session_id:
                log_lines.clear()
                log_lines.append(f"(session {context.resume_session_id[:12]}... expired, starting fresh)")
                options_kwargs.pop("resume", None)
                options = ClaudeAgentOptions(**options_kwargs)
                exit_code = 1
                claude_session_id = ""
                await _query()
            else:
                raise

        output = "\n".join(line for line in log_lines if line).strip()
        if len(output) > 65536:
            output = output[-65536:]
        if not output:
            output = "Claude Agent SDK run completed."

        return AgentRunResult(
            exit_code=exit_code,
            output=output,
            raw_output=claude_session_id,
        )

    # ── CLI backend ──

    async def _run_cli(
        self,
        *,
        workspace_root: Path,
        prompt: str,
        model: str,
        context: AgentRunContext,
        on_message: Callable[[str], None] | None = None,
    ) -> AgentRunResult:
        template = self._command_template()
        if not template:
            raise RuntimeError("CLI backend selected but no command template is configured")

        command = template.format(
            prompt=shlex.quote(prompt),
            run_id=shlex.quote(context.run_id),
            model=shlex.quote(model),
            workspace=shlex.quote(str(workspace_root)),
        )
        env = self._cli_subprocess_env(workspace_root=workspace_root, context=context, model=model)
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(workspace_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )

        # Lazy import to avoid potential circular deps
        from infra import claude_agent_runs

        run_id = context.run_id
        assistant_texts: list[str] = []
        raw_lines: list[str] = []
        buf = b""
        while True:
            chunk = await proc.stdout.read(4096) if proc.stdout else None
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line_bytes, buf = buf.split(b"\n", 1)
                line = line_bytes.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                raw_lines.append(line)
                try:
                    obj = json.loads(line)
                except (json.JSONDecodeError, TypeError):
                    assistant_texts.append(line)
                    if on_message:
                        on_message(line)
                    continue
                obj_type = obj.get("type", "")
                if obj_type == "assistant":
                    message = obj.get("message", {})
                    for block in message.get("content", []):
                        text = block.get("text", "")
                        if text:
                            assistant_texts.append(text)
                            if on_message:
                                on_message(text)
                            try:
                                claude_agent_runs.append_event(
                                    run_id, "assistant_message",
                                    {"text": text, "seq": len(assistant_texts)},
                                )
                            except Exception:
                                pass
                        # Emit tool_use call events
                        if block.get("type") == "tool_use":
                            tool_name = block.get("name", "?")
                            tool_input = block.get("input", {})
                            try:
                                claude_agent_runs.append_event(
                                    run_id, "tool_call",
                                    {"tool": tool_name, "input": json.dumps(tool_input, ensure_ascii=False)[:500]},
                                )
                            except Exception:
                                pass
                elif obj_type == "user":
                    for block in obj.get("message", {}).get("content", []):
                        if block.get("type") == "tool_result":
                            content = block.get("content", "")
                            is_error = block.get("is_error", False)
                            content_preview = (content if isinstance(content, str) else json.dumps(content))[:300]
                            try:
                                claude_agent_runs.append_event(
                                    run_id, "tool_result",
                                    {"content": content_preview, "is_error": is_error},
                                )
                            except Exception:
                                pass
                elif obj_type == "system":
                    if obj.get("subtype") == "init":
                        text = f"[Claude Agent started — model: {obj.get('model', '?')}]"
                        assistant_texts.append(text)
                        if on_message:
                            on_message(text)

        await proc.wait()
        raw_output = "\n".join(raw_lines)
        clean_output, _ = self._parse_cli_output(raw_output)
        return AgentRunResult(
            exit_code=int(proc.returncode or 0),
            output=clean_output[-65536:],
            raw_output=raw_output[-131072:],
        )

    # ── CLI helpers ──

    def _command_template(self, *, explicit_only: bool = False) -> str:
        explicit = os.environ.get("EVOTOWN_CLAUDE_CODE_COMMAND", "").strip()
        if explicit:
            return explicit
        if explicit_only:
            return ""
        return self._default_claude_command()

    def _default_claude_command(self) -> str:
        script = Path(__file__).resolve().parent.parent / "scripts" / "run_claude_code.sh"
        if script.is_file() and shutil.which("claude"):
            return f"bash {shlex.quote(str(script))} {{prompt}} {{model}} {{workspace}} {{run_id}}"
        if shutil.which("claude"):
            return (
                'claude -p {prompt} --model {model} '
                '--allowedTools "Read,Edit,Bash,Glob,Grep,Write" '
                "--append-system-prompt-file .evotown/AGENT_CONTEXT.md"
            )
        # Fallback: use bundled Claude CLI from the SDK package
        bundled = Path("/usr/local/lib/python3.11/site-packages/claude_agent_sdk/_bundled/claude")
        if bundled.is_file():
            max_turns = self._max_turns() or 100
            return (
                f"{shlex.quote(str(bundled))} -p {{prompt}} --model {{model}} "
                "--permission-mode acceptEdits "
                f'--allowedTools "Read,Edit,Bash,Glob,Grep,Write,mcp__mcp__*" '
                f"--max-turns {max_turns} "
                "--output-format stream-json --verbose --bare "
                "--append-system-prompt-file .evotown/AGENT_CONTEXT.md"
            )
        return ""

    def _cli_subprocess_env(
        self,
        *,
        workspace_root: Path,
        context: AgentRunContext,
        model: str,
    ) -> dict[str, str]:
        gateway_env = gateway_sdk_env(agent_id=context.agent_id)
        api_key = gateway_env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "").strip()
        # Strip sensitive env vars before passing to agent subprocess
        _STRIP_ENV_PREFIXES = (
            "ADMIN_", "EVOTOWN_DATABASE_MCP_", "EVOTOWN_DEV_",
            "EVOTOWN_ENGINE_INGEST_",
        )
        stripped_env = {
            k: v for k, v in os.environ.items()
            if not any(k.startswith(p) for p in _STRIP_ENV_PREFIXES)
        }
        env: dict[str, str] = {
            **stripped_env,
            "NODE_TLS_REJECT_UNAUTHORIZED": "0",
            "CLAUDE_CODE_SIMPLE": "1",
            "ANTHROPIC_API_KEY": api_key,
            "EVOTOWN_AGENT_RUN_ID": context.run_id,
            "EVOTOWN_WORKSPACE_ROOT": str(workspace_root),
            "EVOTOWN_CLAUDE_MODEL": model,
        }
        if gateway_env.get("ANTHROPIC_BASE_URL"):
            env["ANTHROPIC_BASE_URL"] = gateway_env["ANTHROPIC_BASE_URL"]
        elif api_key:
            env.setdefault("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
        env.update({k: str(v) for k, v in gateway_env.items() if k not in env})
        return env

    @staticmethod
    def _parse_cli_output(raw_output: str) -> tuple[str, str]:
        """Parse stream-json CLI output into human-readable text.

        Returns (text_output, result_summary).
        """
        lines = raw_output.splitlines()
        assistant_texts: list[str] = []
        result_text = ""
        exit_code_text = ""

        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except (json.JSONDecodeError, TypeError):
                assistant_texts.append(line)
                continue

            obj_type = obj.get("type", "")
            if obj_type == "assistant":
                message = obj.get("message", {})
                for block in message.get("content", []):
                    text = block.get("text", "")
                    if text:
                        assistant_texts.append(text)
            elif obj_type == "result":
                result_text = obj.get("result", "") or ""
                if obj.get("is_error") and not result_text:
                    result_text = obj.get("subtype", "error")
                exit_code_text = result_text
            elif obj_type == "system":
                subtype = obj.get("subtype", "")
                if subtype == "init":
                    assistant_texts.append(f"[Claude Agent started — model: {obj.get('model', '?')}]")
            elif obj_type == "user":
                pass  # skip tool_result content

        if not assistant_texts:
            default = result_text or exit_code_text or "[no output]"
            return default, default

        full_text = "\n\n".join(assistant_texts)
        summary = result_text or assistant_texts[-1]
        return full_text, summary

    # ── 内部配置 ──

    def _allowed_tools(self) -> list[str]:
        raw = os.environ.get("EVOTOWN_CLAUDE_ALLOWED_TOOLS", "Read,Edit,Bash,Glob,Grep,Write")
        return [item.strip() for item in raw.split(",") if item.strip()]

    def _system_prompt(self, workspace_root: Path) -> dict[str, Any] | str | None:
        context_path = workspace_root / ".evotown" / "AGENT_CONTEXT.md"
        if not context_path.is_file():
            return None
        append = context_path.read_text(encoding="utf-8").strip()
        if not append:
            return None
        return {"type": "preset", "preset": "claude_code", "append": append}

    def _mcp_servers(self, workspace_root: Path) -> dict[str, Any] | Path | str:
        mcp_path = workspace_root / ".mcp.json"
        if mcp_path.is_file():
            return mcp_path
        return {}

    def _max_turns(self) -> int | None:
        raw = os.environ.get("EVOTOWN_CLAUDE_MAX_TURNS", "").strip()
        if not raw:
            return None
        try:
            value = int(raw)
        except ValueError:
            return None
        return value if value > 0 else None
