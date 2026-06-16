"""MCP handler loader — importlib + mtime hot-reload."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from typing import Any

MCP_SERVICES_DIR = Path(os.environ.get("MCP_SERVICES_DIR", "/app/data/mcp-services"))
_handler_cache: dict[str, tuple[float, Any]] = {}


def _handler_path(service_id: str) -> Path:
    return MCP_SERVICES_DIR / service_id / "handler.py"


def get_handler(service_id: str):
    """Load handler.py from mcp-services/{service_id}/, auto-reload on file change."""
    path = _handler_path(service_id)
    if not path.is_file():
        raise FileNotFoundError(f"handler not found: {service_id}")

    mtime = path.stat().st_mtime

    if service_id in _handler_cache:
        cached_mtime, module = _handler_cache[service_id]
        if cached_mtime == mtime:
            return module

    # Reload
    module_name = f"_mcp_handler_{service_id}"
    spec = importlib.util.spec_from_file_location(module_name, str(path))
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load handler: {service_id}")
    module = importlib.util.module_from_spec(spec)

    # Inject mcp_call for internal inter-MCP calls
    module.__dict__["mcp_call"] = _make_mcp_call()

    spec.loader.exec_module(module)

    if not hasattr(module, "process") or not callable(module.process):
        raise ValueError(f"handler must define process(args, permissions): {service_id}")

    _handler_cache[service_id] = (mtime, module)
    return module


def _make_mcp_call():
    """Closure to avoid circular imports."""
    def mcp_call(service_id: str, args: dict) -> Any:
        handler = get_handler(service_id)
        return handler.process(args, {})
    return mcp_call


def clear_handler_cache(service_id: str | None = None):
    """Clear cache for a specific handler or all handlers."""
    global _handler_cache
    if service_id:
        _handler_cache.pop(service_id, None)
    else:
        _handler_cache.clear()
