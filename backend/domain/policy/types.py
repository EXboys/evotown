"""Policy evaluation types."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

PolicyCheckKind = Literal[
    "tool",
    "file_read",
    "file_write",
    "network",
    "artifact",
    "text",
]

PolicyDecisionAction = Literal["allowed", "warned", "blocked", "needs_review"]


@dataclass
class EvaluationContext:
    kind: PolicyCheckKind
    resource: str
    run_id: str = ""
    engine_id: str = ""
    workspace_roots: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class PolicyHit:
    policy_id: str
    category: str
    action: PolicyDecisionAction
    severity: str
    message: str
    resource_type: str
    resource: str


@dataclass
class PolicyEvaluation:
    allowed: bool
    action: PolicyDecisionAction
    hits: list[PolicyHit] = field(default_factory=list)
    redacted_text: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "action": self.action,
            "hits": [
                {
                    "policy_id": hit.policy_id,
                    "category": hit.category,
                    "action": hit.action,
                    "severity": hit.severity,
                    "message": hit.message,
                    "resource_type": hit.resource_type,
                    "resource": hit.resource,
                }
                for hit in self.hits
            ],
            "redacted_text": self.redacted_text,
        }
