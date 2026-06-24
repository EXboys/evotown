"""Embedded Codex SDK execution for hosted coding workspaces."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

_SDK_IMPORT_ERROR: str | None = None


def sdk_available() -> bool:
    """Return True when openai-codex is importable."""
    global _SDK_IMPORT_ERROR
    try:
        import openai_codex  # noqa: F401
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


def gateway_sdk_env() -> dict[str, str]:
    if not _truthy_env("EVOTOWN_CODEX_USE_GATEWAY"):
        return {}
    base_url = os.environ.get("EVOTOWN_CODEX_GATEWAY_BASE_URL", "").strip().rstrip("/")
    api_key = os.environ.get("EVOTOWN_CODEX_GATEWAY_API_KEY", "").strip()
    env: dict[str, str] = {}
    if base_url:
        env["OPENAI_BASE_URL"] = base_url
    if api_key:
        env["OPENAI_API_KEY"] = api_key
    return env


def _sdk_ready() -> bool:
    direct_key = os.environ.get("OPENAI_API_KEY", "").strip()
    gateway_key = os.environ.get("EVOTOWN_CODEX_GATEWAY_API_KEY", "").strip()
    gateway_enabled = _truthy_env("EVOTOWN_CODEX_USE_GATEWAY")
    return bool(sdk_available() and (direct_key or (gateway_enabled and gateway_key)))


def _sandbox_mode():
    from openai_codex import Sandbox

    raw = os.environ.get("EVOTOWN_CODEX_SANDBOX", "workspace_write").strip().lower()
    if raw in {"read_only", "readonly", "read-only"}:
        return Sandbox.read_only
    if raw in {"full_access", "full-access", "full"}:
        return Sandbox.full_access
    return Sandbox.workspace_write


def _write_gateway_config(workspace_root: Path) -> None:
    """Write per-workspace Codex config when routing through Evotown Gateway."""
    base_url = os.environ.get("EVOTOWN_CODEX_GATEWAY_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        return
    config_dir = workspace_root / ".codex"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_path = config_dir / "config.toml"
    model = os.environ.get("EVOTOWN_CODEX_MODEL", "").strip()
    lines = [f'openai_base_url = "{base_url}"']
    if model:
        lines.append(f'model = "{model}"')
    config_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


async def run_agent_sdk(
    *,
    workspace_root: Path,
    prompt: str,
    model: str,
    run: dict[str, Any],
) -> tuple[int, str]:
    """Run a single hosted agent task via the embedded Codex SDK."""
    from openai_codex import AsyncCodex

    if _truthy_env("EVOTOWN_CODEX_USE_GATEWAY"):
        _write_gateway_config(workspace_root)

    run_env = {
        **gateway_sdk_env(),
        "EVOTOWN_AGENT_RUN_ID": str(run.get("run_id") or ""),
        "EVOTOWN_WORKSPACE_ROOT": str(workspace_root),
    }
    if model:
        run_env["EVOTOWN_CODEX_MODEL"] = model

    previous_cwd = os.getcwd()
    previous_env = {key: os.environ.get(key) for key in run_env}
    try:
        os.environ.update(run_env)
        os.chdir(workspace_root)
        async with AsyncCodex() as codex:
            kwargs: dict[str, Any] = {"sandbox": _sandbox_mode()}
            if model:
                kwargs["model"] = model
            thread = await codex.thread_start(**kwargs)
            result = await thread.run(prompt)
    finally:
        os.chdir(previous_cwd)
        for key, value in previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    output = str(getattr(result, "final_response", "") or "").strip()
    if not output:
        output = str(getattr(result, "output_text", "") or "").strip()
    is_error = bool(getattr(result, "is_error", False))
    exit_code = 1 if is_error or not output else 0
    if not output:
        output = "Codex SDK run completed with no text output."
    return exit_code, output


def execution_backend() -> str:
    """Resolve Codex run backend: embedded SDK or dry-run."""
    mode = os.environ.get("EVOTOWN_CODEX_EXECUTION_MODE", "auto").strip().lower()
    if mode == "dry-run":
        return "dry-run"
    if mode == "sdk":
        return "sdk" if _sdk_ready() else "dry-run"
    return "sdk" if _sdk_ready() else "dry-run"
