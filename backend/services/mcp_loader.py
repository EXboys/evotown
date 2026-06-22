"""MCP handler loader — importlib + mtime hot-reload + version injection.

Service ID format: "{category}/{service_name}"  (two-layer path)
Prod dir:  mcp-services/{category}/{service_name}/handler.py
Dev dir:   mcp-dev/{category}/{service_name}/handler.py
"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from typing import Any

MCP_SERVICES_DIR = Path(os.environ.get("MCP_SERVICES_DIR", "/app/data/mcp-services"))
MCP_DEV_DIR = Path(os.environ.get("MCP_DEV_DIR", "/app/data/mcp-dev"))
SYSTEM_MCP_DIR = Path(__file__).resolve().parent / "mcp_system"
_handler_cache: dict[str, tuple[float, Any]] = {}


def _handler_path(service_id: str) -> Path:
    """Handler path based on source prefix.

    system-*   → backend/services/mcp_system/{name}/handler.py
    internal   → /app/data/mcp-services/{mcp_path}/handler.py (from DB)
    """
    if service_id.startswith("system-"):
        name = service_id[len("system-"):]
        return SYSTEM_MCP_DIR / name / "handler.py"
    # Look up mcp_path from service record for correct directory mapping
    from infra import mcp_registry
    svc = mcp_registry.get_service(service_id)
    if svc:
        mcp_path = (svc.get("mcp_path") or "").strip("/")
        if mcp_path:
            return MCP_SERVICES_DIR / mcp_path / "handler.py"
    return MCP_SERVICES_DIR / service_id / "handler.py"


def _manifest_path(service_id: str) -> Path:
    """Manifest path based on source prefix."""
    if service_id.startswith("system-"):
        name = service_id[len("system-"):]
        return SYSTEM_MCP_DIR / name / "manifest.json"
    from infra import mcp_registry
    svc = mcp_registry.get_service(service_id)
    if svc:
        mcp_path = (svc.get("mcp_path") or "").strip("/")
        if mcp_path:
            return MCP_SERVICES_DIR / mcp_path / "manifest.json"
    return MCP_SERVICES_DIR / service_id / "manifest.json"


def _dev_handler_path(service_id: str) -> Path:
    """Dev handler path: mcp-dev/{category}/{service_name}/handler.py"""
    return MCP_DEV_DIR / service_id / "handler.py"


def _dev_manifest_path(service_id: str) -> Path:
    """Dev manifest path."""
    return MCP_DEV_DIR / service_id / "manifest.json"


def _load_version(manifest_path: str | Path) -> str:
    """Read version from manifest.json, default '0.0.0'."""
    try:
        raw = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        return str(raw.get("version", "0.0.0"))
    except Exception:
        return "0.0.0"


def _load_module_from_path(handler_path: Path, service_id: str) -> Any:
    """Import a handler.py from the given path."""
    module_name = f"_mcp_handler_{service_id.replace('/', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, str(handler_path))
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load handler: {service_id}")
    module = importlib.util.module_from_spec(spec)

    # Inject mcp_call for internal inter-MCP calls
    module.__dict__["mcp_call"] = _make_mcp_call()

    spec.loader.exec_module(module)

    if not hasattr(module, "process") or not callable(module.process):
        raise ValueError(f"handler must define process(args, permissions): {service_id}")

    return module


def get_handler(service_id: str):
    """Load handler with source-aware routing, auto-reload on file change.

    system-*   → backend/services/mcp_system/{name}/handler.py
    internal   → /app/data/mcp-services/{service_id}/handler.py
    """
    path = _handler_path(service_id)
    if not path.is_file():
        raise FileNotFoundError(f"handler not found: {service_id}")

    mtime = path.stat().st_mtime
    cache_key = f"prod:{service_id}"

    if cache_key in _handler_cache:
        cached_mtime, module = _handler_cache[cache_key]
        if cached_mtime == mtime:
            return module

    module = _load_module_from_path(path, service_id)
    _handler_cache[cache_key] = (mtime, module)
    return module


def invoke_mcp(service_id: str, args: dict, permissions: dict) -> dict[str, Any]:
    """Prod invoke: handler.process(args, permissions) → wrapped {ok, data, error, version}."""
    try:
        handler = get_handler(service_id)
        result = handler.process(args, permissions)
        version = _load_version(_manifest_path(service_id))
        return {"ok": True, "data": result, "error": None, "version": version}
    except Exception as exc:
        return {"ok": False, "data": None, "error": str(exc), "version": "0.0.0"}


def invoke_mcp_dev(service_id: str, args: dict, permissions: dict) -> dict[str, Any]:
    """Dev invoke: load from mcp-dev/{category}/{name}/handler.py."""

    handler_path = _dev_handler_path(service_id)
    if not handler_path.is_file():
        return {"ok": False, "data": None, "error": f"dev handler not found: {handler_path}", "version": "0.0.0"}

    try:
        module = _load_module_from_path(handler_path, f"dev:{service_id}")
        result = module.process(args, permissions)
        version = _load_version(_dev_manifest_path(service_id))
        return {"ok": True, "data": result, "error": None, "version": version}
    except Exception as exc:
        return {"ok": False, "data": None, "error": str(exc), "version": "0.0.0"}


mcp_dev_call = invoke_mcp_dev


def _make_mcp_call():
    """Closure for internal inter-MCP calls (prod only)."""

    def mcp_call(service_id: str, args: dict) -> Any:
        handler = get_handler(service_id)
        return handler.process(args, {})

    return mcp_call


def clear_handler_cache(service_id: str | None = None):
    """Clear cache for a specific handler or all handlers."""
    global _handler_cache
    if service_id:
        _handler_cache.pop(f"prod:{service_id}", None)
    else:
        _handler_cache.clear()
