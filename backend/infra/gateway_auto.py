"""Heuristic auto model tier selection for gateway alias routing."""
from __future__ import annotations

import json
from typing import Any

TIER_ORDER = ("fast", "balanced", "strong")

DEFAULT_AUTO_POLICY: dict[str, Any] = {
    "tiers": {
        "fast": "",
        "balanced": "",
        "strong": "",
    },
    "threshold_tokens_fast": 2000,
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
    fast_below = int(cfg.get("threshold_tokens_fast", 2000))

    if est_tokens >= strong_at:
        return "strong", f"estimated_tokens>={strong_at}"
    if est_tokens < fast_below:
        return "fast", f"estimated_tokens<{fast_below}"
    return "balanced", f"estimated_tokens between {fast_below} and {strong_at}"


def _safe_float(raw: Any, default: float) -> float:
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def _tier_fallback_order(start_tier: str, policy: dict[str, Any]) -> list[str]:
    raw_order = policy.get("tier_fallback_order")
    if isinstance(raw_order, list):
        configured = [str(item).strip() for item in raw_order if str(item).strip() in TIER_ORDER]
        ordered = [start_tier, *[tier for tier in configured if tier != start_tier]]
    else:
        start_index = TIER_ORDER.index(start_tier) if start_tier in TIER_ORDER else 0
        ordered = list(TIER_ORDER[start_index:])
    return ordered or [start_tier]


def _normalize_tier_models(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, str):
        model = raw.strip()
        return [{"model": model, "weight": 100.0, "score": 100.0}] if model else []
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []

    members: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if isinstance(item, str):
            model = item.strip()
            member = {"model": model, "weight": 100.0, "score": 100.0, "index": index}
        elif isinstance(item, dict):
            model = str(item.get("model") or item.get("model_name") or item.get("name") or "").strip()
            enabled = item.get("enabled", True)
            weight = max(0.0, _safe_float(item.get("weight"), 100.0))
            quota_tokens = max(0.0, _safe_float(item.get("quota_tokens"), 0.0))
            remaining_raw = item.get("quota_remaining_tokens", item.get("remaining_tokens"))
            remaining_tokens = max(0.0, _safe_float(remaining_raw, quota_tokens or 1.0))
            if quota_tokens > 0:
                quota_ratio = min(1.0, remaining_tokens / quota_tokens)
            else:
                quota_ratio = 1.0
            member = {
                "model": model,
                "weight": weight,
                "score": weight * quota_ratio,
                "index": index,
            }
            if enabled is False:
                member["score"] = 0.0
        else:
            continue
        if member["model"] and member["weight"] > 0 and member["score"] > 0:
            members.append(member)

    return sorted(members, key=lambda member: (-member["score"], -member["weight"], member["index"]))


def resolve_auto_model_chain(body: dict[str, Any], policy: dict[str, Any] | None) -> tuple[list[str], str, str]:
    """Pick ordered concrete models from auto_policy tiers. Returns (models, tier, reason)."""
    cfg = {**DEFAULT_AUTO_POLICY, **(policy or {})}
    tiers = cfg.get("tiers") if isinstance(cfg.get("tiers"), dict) else {}
    tier, reason = classify_tier(body, cfg)

    chain: list[str] = []
    seen: set[str] = set()
    chosen_tier = tier
    for fallback_tier in _tier_fallback_order(tier, cfg):
        members = _normalize_tier_models(tiers.get(fallback_tier))
        if not members:
            continue
        if fallback_tier != tier and not chain:
            chosen_tier = fallback_tier
            reason = f"{reason};fallback_tier={fallback_tier}"
        for member in members:
            model = str(member["model"]).strip()
            if model and model not in seen:
                seen.add(model)
                chain.append(model)
    return chain, chosen_tier, reason


def resolve_auto_model(body: dict[str, Any], policy: dict[str, Any] | None) -> tuple[str, str, str]:
    """Pick concrete model from auto_policy tiers. Returns (model, tier, reason)."""
    chain, tier, reason = resolve_auto_model_chain(body, policy)
    return (chain[0] if chain else ""), tier, reason


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
