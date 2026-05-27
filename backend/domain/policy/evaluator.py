"""Evaluate enterprise policies against connector/runtime actions."""
from __future__ import annotations

import fnmatch
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from domain.policy.types import EvaluationContext, PolicyEvaluation, PolicyHit

_ACTION_RANK = {"allowed": 0, "warned": 1, "needs_review": 2, "blocked": 3}


def _expand_roots(roots: list[str]) -> list[Path]:
    resolved: list[Path] = []
    for item in roots:
        if not item:
            continue
        expanded = os.path.expandvars(os.path.expanduser(str(item).strip()))
        if expanded:
            resolved.append(Path(expanded).resolve())
    return resolved


def _host_matches(host: str, pattern: str) -> bool:
    host = host.lower().strip(".")
    pattern = pattern.lower().strip()
    if not pattern:
        return False
    if pattern.startswith("*."):
        suffix = pattern[1:]
        return host == pattern[2:] or host.endswith(suffix)
    return host == pattern or fnmatch.fnmatch(host, pattern)


def _path_matches(path: str, pattern: str) -> bool:
    normalized = path.replace("\\", "/")
    return fnmatch.fnmatch(normalized, pattern.replace("\\", "/"))


def _merge_action(current: str, new: str) -> str:
    return new if _ACTION_RANK.get(new, 0) > _ACTION_RANK.get(current, 0) else current


class PolicyEvaluator:
    """Stateless evaluator over a list of enabled policy records."""

    def __init__(self, policies: list[dict[str, Any]]) -> None:
        self._policies = [p for p in policies if p.get("enabled", True)]

    def evaluate(self, ctx: EvaluationContext) -> PolicyEvaluation:
        hits: list[PolicyHit] = []
        action = "allowed"
        redacted: str | None = None

        for policy in self._policies:
            category = str(policy.get("category") or "")
            rules = policy.get("rules") or {}
            if not isinstance(rules, dict):
                continue
            policy_id = str(policy.get("policy_id") or "")

            if ctx.kind == "tool" and category == "tool":
                hit = self._eval_tool(policy_id, rules, ctx)
            elif ctx.kind in {"file_read", "file_write"} and category == "workspace":
                hit = self._eval_workspace(policy_id, rules, ctx)
            elif ctx.kind == "network" and category == "network":
                hit = self._eval_network(policy_id, rules, ctx)
            elif ctx.kind == "artifact" and category == "artifact":
                hit = self._eval_artifact(policy_id, rules, ctx)
            elif ctx.kind == "text" and category in {"security", "artifact"}:
                hit, maybe_redacted = self._eval_text(policy_id, rules, ctx, category)
                if maybe_redacted is not None:
                    redacted = maybe_redacted
            else:
                hit = None

            if hit is None:
                continue
            hits.append(hit)
            action = _merge_action(action, hit.action)

        allowed = action in {"allowed", "warned"}
        return PolicyEvaluation(allowed=allowed, action=action, hits=hits, redacted_text=redacted)

    def _eval_tool(self, policy_id: str, rules: dict[str, Any], ctx: EvaluationContext) -> PolicyHit | None:
        tool = (ctx.resource or "").strip()
        if not tool:
            return None
        tool_key = tool.lower()
        deny = {str(x).lower() for x in rules.get("deny_tools") or []}
        allow = {str(x).lower() for x in rules.get("allow_tools") or [] if x}
        approval = {str(x).lower() for x in rules.get("require_approval_tools") or []}

        if tool_key in deny or any(tool_key == d or tool_key.endswith(f"/{d}") for d in deny):
            return PolicyHit(
                policy_id=policy_id,
                category="tool",
                action="blocked",
                severity="critical",
                message=f"Tool '{tool}' is denied by policy.",
                resource_type="tool",
                resource=tool,
            )
        if allow and tool_key not in allow and not any(tool_key.endswith(f"/{a}") for a in allow):
            return PolicyHit(
                policy_id=policy_id,
                category="tool",
                action="blocked",
                severity="high",
                message=f"Tool '{tool}' is not in the allowlist.",
                resource_type="tool",
                resource=tool,
            )
        if tool_key in approval or any(tool_key.endswith(f"/{a}") for a in approval):
            return PolicyHit(
                policy_id=policy_id,
                category="tool",
                action="warned",
                severity="medium",
                message=f"Tool '{tool}' requires approval (warn-only in v1.5).",
                resource_type="tool",
                resource=tool,
            )
        return None

    def _eval_workspace(self, policy_id: str, rules: dict[str, Any], ctx: EvaluationContext) -> PolicyHit | None:
        raw_path = (ctx.resource or "").strip()
        if not raw_path:
            return None
        path = Path(os.path.expanduser(raw_path))
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path

        policy_roots = _expand_roots(list(rules.get("workspace_roots") or []))
        ctx_roots = _expand_roots(ctx.workspace_roots)
        roots = policy_roots + ctx_roots
        if not roots:
            roots = _expand_roots(["~/.evotown/workspace", "~/.openclaw/workspace"])

        path_str = str(resolved).replace("\\", "/")
        for pattern in rules.get("deny_path_patterns") or []:
            if _path_matches(path_str, str(pattern)):
                return PolicyHit(
                    policy_id=policy_id,
                    category="workspace",
                    action="blocked",
                    severity="critical",
                    message=f"Path '{raw_path}' matches deny pattern '{pattern}'.",
                    resource_type=ctx.kind,
                    resource=raw_path,
                )

        def _under_root(candidate: Path, root: Path) -> bool:
            if candidate == root:
                return True
            try:
                candidate.relative_to(root)
                return True
            except ValueError:
                return False

        in_workspace = any(_under_root(resolved, root) for root in roots)
        if not in_workspace:
            return PolicyHit(
                policy_id=policy_id,
                category="workspace",
                action="blocked",
                severity="high",
                message=f"Path '{raw_path}' is outside allowed workspace roots.",
                resource_type=ctx.kind,
                resource=raw_path,
            )

        if ctx.kind == "file_write":
            for pattern in rules.get("require_approval_write_patterns") or []:
                if _path_matches(path_str, str(pattern)):
                    return PolicyHit(
                        policy_id=policy_id,
                        category="workspace",
                        action="warned",
                        severity="medium",
                        message=f"Write to '{raw_path}' requires approval (warn-only in v1.5).",
                        resource_type="file_write",
                        resource=raw_path,
                    )
        return None

    def _eval_network(self, policy_id: str, rules: dict[str, Any], ctx: EvaluationContext) -> PolicyHit | None:
        raw = (ctx.resource or "").strip()
        if not raw:
            return None
        host = raw.lower()
        if "://" in raw:
            parsed = urlparse(raw if "://" in raw else f"https://{raw}")
            host = (parsed.hostname or "").lower()
        if not host:
            return None

        deny = [str(x) for x in rules.get("deny_domains") or []]
        allow = [str(x) for x in rules.get("allow_domains") or [] if x]
        approval = [str(x) for x in rules.get("require_approval_domains") or []]

        for pattern in deny:
            if _host_matches(host, pattern):
                return PolicyHit(
                    policy_id=policy_id,
                    category="network",
                    action="blocked",
                    severity="critical",
                    message=f"Host '{host}' is denied by network policy.",
                    resource_type="network",
                    resource=raw,
                )
        if allow and not any(_host_matches(host, pattern) for pattern in allow):
            return PolicyHit(
                policy_id=policy_id,
                category="network",
                action="blocked",
                severity="high",
                message=f"Host '{host}' is not in the domain allowlist.",
                resource_type="network",
                resource=raw,
            )
        for pattern in approval:
            if _host_matches(host, pattern):
                return PolicyHit(
                    policy_id=policy_id,
                    category="network",
                    action="warned",
                    severity="medium",
                    message=f"Host '{host}' requires approval for egress (warn-only in v1.5).",
                    resource_type="network",
                    resource=raw,
                )
        return None

    def _eval_artifact(self, policy_id: str, rules: dict[str, Any], ctx: EvaluationContext) -> PolicyHit | None:
        path = (ctx.resource or "").strip()
        size = int(ctx.extra.get("bytes") or 0)
        max_bytes = int(rules.get("max_bytes") or 0)
        if max_bytes > 0 and size > max_bytes:
            return PolicyHit(
                policy_id=policy_id,
                category="artifact",
                action="blocked",
                severity="high",
                message=f"Artifact size {size} exceeds limit {max_bytes}.",
                resource_type="artifact",
                resource=path or f"bytes:{size}",
            )
        ext = Path(path).suffix.lower() if path else str(ctx.extra.get("extension") or "").lower()
        if ext and not ext.startswith("."):
            ext = f".{ext}"
        blocked_ext = {str(x).lower() for x in rules.get("blocked_extensions") or []}
        allowed_ext = {str(x).lower() for x in rules.get("allowed_extensions") or [] if x}
        if ext and ext in blocked_ext:
            return PolicyHit(
                policy_id=policy_id,
                category="artifact",
                action="blocked",
                severity="high",
                message=f"Artifact extension '{ext}' is blocked.",
                resource_type="artifact",
                resource=path or ext,
            )
        if allowed_ext and ext and ext not in allowed_ext:
            return PolicyHit(
                policy_id=policy_id,
                category="artifact",
                action="blocked",
                severity="medium",
                message=f"Artifact extension '{ext}' is not allowed.",
                resource_type="artifact",
                resource=path or ext,
            )
        return None

    def _eval_text(
        self,
        policy_id: str,
        rules: dict[str, Any],
        ctx: EvaluationContext,
        category: str,
    ) -> tuple[PolicyHit | None, str | None]:
        text = str(ctx.extra.get("text") or ctx.resource or "")
        if not text:
            return None, None
        patterns = [str(x).lower() for x in rules.get("redact_patterns") or []]
        lowered = text.lower()
        matched = [p for p in patterns if p and p in lowered]
        if not matched:
            return None, None

        from infra.redaction import redact_text

        redacted = redact_text(text)
        block = bool(rules.get("block_secret_in_artifacts", False))
        if block:
            return (
                PolicyHit(
                    policy_id=policy_id,
                    category=category,
                    action="blocked",
                    severity="critical",
                    message="Sensitive secret-like content detected; upload blocked.",
                    resource_type="text",
                    resource="[redacted]",
                ),
                redacted,
            )
        return (
            PolicyHit(
                policy_id=policy_id,
                category=category,
                action="warned",
                severity="medium",
                message="Sensitive patterns detected; content will be redacted.",
                resource_type="text",
                resource="[redacted]",
            ),
            redacted,
        )
