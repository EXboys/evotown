"""Best-effort redaction for ingest logs and context."""
from __future__ import annotations

import re

_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+"), r"\1=[REDACTED]"),
    (re.compile(r"(?i)bearer\s+[a-z0-9\-._~+/]+=*", re.I), "Bearer [REDACTED]"),
    (re.compile(r"\bsk-[a-zA-Z0-9]{16,}\b"), "sk-[REDACTED]"),
    (re.compile(r"\bevk_[a-zA-Z0-9]{16,}\b"), "evk_[REDACTED]"),
    (re.compile(r"\bevi_[a-zA-Z0-9\-_]{16,}\b"), "evi_[REDACTED]"),
]


def redact_text(text: str, *, max_len: int = 65536) -> str:
    if not text:
        return ""
    value = text[:max_len]
    for pattern, repl in _PATTERNS:
        value = pattern.sub(repl, value)
    return value
