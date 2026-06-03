"""Heuristic auto model tier selection for gateway alias routing."""
from __future__ import annotations

import json
from typing import Any


DEFAULT_AUTO_POLICY: dict[str, Any] = {
    "tiers": {
        "fast": "",
        "balanced": "",
        "strong": "",
    },
    "threshold_tokens_fast": 500,
    "threshold_tokens_strong": 8000,
    "tools_use_strong": True,
}


def _estimate_message_chars(messages: list[Any]) -> int:
    total = 0
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if isinstance(content, str):
            total += len(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict):
                    text = part.get("text") or part.get("content") or ""
                    if isinstance(text, str):
                        total += len(text)
    return total


def _chars_to_tokens(chars: int) -> int:
    return max(1, chars // 4)


def classify_tier(body: dict[str, Any], policy: dict[str, Any] | None) -> tuple[str, str]:
    """Return (tier_name, reason). tier in fast | balanced | strong."""
    cfg = {**DEFAULT_AUTO_POLICY, **(policy or {})}
    messages = body.get("messages") if isinstance(body.get("messages"), list) else []
    est_tokens = _chars_to_tokens(_estimate_message_chars(messages))

    if cfg.get("tools_use_strong") and body.get("tools"):
        return "strong", "tools_present"

    strong_at = int(cfg.get("threshold_tokens_strong", 8000))
    fast_below = int(cfg.get("threshold_tokens_fast", 500))

    if est_tokens >= strong_at:
        return "strong", f"estimated_tokens>={strong_at}"
    if est_tokens < fast_below:
        return "fast", f"estimated_tokens<{fast_below}"
    return "balanced", f"estimated_tokens between {fast_below} and {strong_at}"


def resolve_auto_model(body: dict[str, Any], policy: dict[str, Any] | None) -> tuple[str, str, str]:
    """Pick concrete model from auto_policy tiers. Returns (model, tier, reason)."""
    cfg = {**DEFAULT_AUTO_POLICY, **(policy or {})}
    tiers = cfg.get("tiers") if isinstance(cfg.get("tiers"), dict) else {}
    tier, reason = classify_tier(body, cfg)

    model = str(tiers.get(tier) or "").strip()
    if not model:
        for fallback_tier in ("balanced", "fast", "strong"):
            model = str(tiers.get(fallback_tier) or "").strip()
            if model:
                tier = fallback_tier
                reason = f"{reason};fallback_tier={fallback_tier}"
                break
    return model, tier, reason


def parse_auto_policy(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}
