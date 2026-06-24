"""Embedded Claude Agent SDK execution for hosted coding agents."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

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


def _allowed_tools() -> list[str]:
    raw = os.environ.get("EVOTOWN_CLAUDE_ALLOWED_TOOLS", "Read,Edit,Bash,Glob,Grep,Write")
    return [item.strip() for item in raw.split(",") if item.strip()]


def _system_prompt(workspace_root: Path) -> dict[str, Any] | str | None:
    context_path = workspace_root / ".evotown" / "AGENT_CONTEXT.md"
    if not context_path.is_file():
        return None
    append = context_path.read_text(encoding="utf-8").strip()
    if not append:
        return None
    return {"type": "preset", "preset": "claude_code", "append": append}


def _mcp_servers(workspace_root: Path) -> dict[str, Any] | Path | str:
    mcp_path = workspace_root / ".mcp.json"
    if mcp_path.is_file():
        return mcp_path
    return {}


def _max_turns() -> int | None:
    raw = os.environ.get("EVOTOWN_CLAUDE_MAX_TURNS", "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def gateway_sdk_env(*, agent_id: str = "") -> dict[str, str]:
    if not _truthy_env("EVOTOWN_CLAUDE_USE_GATEWAY"):
        return {}
    base_url = os.environ.get("EVOTOWN_CLAUDE_GATEWAY_BASE_URL", "").strip().rstrip("/")
    # Prefer agent-specific key, fall back to global ADMIN_TOKEN
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


async def run_agent_sdk(
    *,
    workspace_root: Path,
    prompt: str,
    model: str,
    run: dict[str, Any],
    resume_session_id: str = "",
) -> tuple[int, str, str]:
    """Run a single hosted agent task via the embedded Claude Agent SDK.

    Returns (exit_code, output, claude_session_id).
    """
    from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ResultMessage, query

    permission_mode = os.environ.get("EVOTOWN_CLAUDE_PERMISSION_MODE", "acceptEdits").strip() or "acceptEdits"
    options_kwargs: dict[str, Any] = {
        "cwd": workspace_root,
        "model": model or None,
        "permission_mode": permission_mode,
        "allowed_tools": _allowed_tools(),
        "mcp_servers": _mcp_servers(workspace_root),
        "setting_sources": ["project"],
        "env": {
            **gateway_sdk_env(agent_id=str(run.get("agent_id") or "")),
            "EVOTOWN_AGENT_RUN_ID": str(run.get("run_id") or ""),
            "EVOTOWN_WORKSPACE_ROOT": str(workspace_root),
            "EVOTOWN_CLAUDE_MODEL": model,
        },
    }

    # Resume previous Claude session when available (native context management)
    if resume_session_id:
        options_kwargs["resume"] = resume_session_id

    system_prompt = _system_prompt(workspace_root)
    if system_prompt is not None:
        options_kwargs["system_prompt"] = system_prompt
    max_turns = _max_turns()
    if max_turns is not None:
        options_kwargs["max_turns"] = max_turns

    options = ClaudeAgentOptions(**options_kwargs)

    log_lines: list[str] = []
    exit_code = 1
    claude_session_id = ""
    run_id = str(run.get("run_id") or "")

    def _emit(text: str) -> None:
        """Persist intermediate text as an event for SSE streaming."""
        log_lines.append(text)
        if run_id:
            try:
                from infra import claude_agent_runs as _evt
                _evt.append_event(run_id, "assistant_message", {"text": text})
            except Exception:
                pass

    async def _query():
        nonlocal exit_code, claude_session_id
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    text = getattr(block, "text", None)
                    if text:
                        _emit(str(text))
            elif isinstance(message, ResultMessage):
                if message.result:
                    _emit(str(message.result))
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
        # Stale session — retry without resume
        if resume_session_id:
            log_lines.clear()
            log_lines.append(f"(session {resume_session_id[:12]}... expired, starting fresh)")
            resume_session_id = ""
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
    return exit_code, output, claude_session_id
