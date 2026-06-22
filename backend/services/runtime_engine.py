"""Hosted coding workspace runtime engine identifiers."""
from __future__ import annotations

from typing import Any

RUNTIME_ENGINES: frozenset[str] = frozenset({"claude", "codex"})
DEFAULT_RUNTIME_ENGINE = "claude"

ENGINE_IDS: dict[str, str] = {
    "claude": "claude-code-hosted",
    "codex": "codex-sdk-hosted",
}


def normalize_runtime_engine(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in RUNTIME_ENGINES:
        return text
    return DEFAULT_RUNTIME_ENGINE


def engine_id_for_runtime(runtime_engine: str) -> str:
    return ENGINE_IDS.get(normalize_runtime_engine(runtime_engine), ENGINE_IDS["claude"])
