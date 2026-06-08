from __future__ import annotations

import os


def evotown_base_url() -> str:
    return os.environ.get("EVOTOWN_BASE_URL", "http://localhost:8765").rstrip("/")


def evotown_mcp_token() -> str:
    return os.environ.get("EVOTOWN_DATABASE_MCP_TOKEN", "").strip()


def max_rows() -> int:
    return int(os.environ.get("DB_MCP_MAX_ROWS", "1000"))


def listen_host() -> str:
    return os.environ.get("DB_MCP_HOST", "0.0.0.0")


def listen_port() -> int:
    return int(os.environ.get("DB_MCP_PORT", "9100"))
