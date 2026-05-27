"""Orchestrate policy evaluation for HTTP, ingest, and connectors."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from domain.models import PolicyViolationIngest, RunComplete, RunEventIngest
from domain.policy.evaluator import PolicyEvaluator
from domain.policy.types import EvaluationContext, PolicyEvaluation
from infra import policies
from infra import engine_ingest


class PolicyEnforcementError(Exception):
    """Raised when an ingest action is blocked by policy."""

    def __init__(self, evaluation: PolicyEvaluation) -> None:
        self.evaluation = evaluation
        super().__init__(evaluation.hits[0].message if evaluation.hits else "blocked by policy")


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_evaluator(*, enabled_only: bool = True) -> PolicyEvaluator:
    payload = policies.list_policies(enabled_only=enabled_only)
    return PolicyEvaluator(list(payload.get("policies") or []))


def evaluate_context(ctx: EvaluationContext) -> PolicyEvaluation:
    return load_evaluator().evaluate(ctx)


def record_violations(
    evaluation: PolicyEvaluation,
    *,
    run_id: str,
    engine_id: str,
) -> list[dict[str, Any]]:
    stored: list[dict[str, Any]] = []
    if not run_id or not engine_id:
        return stored
    for hit in evaluation.hits:
        if hit.action == "allowed":
            continue
        body = PolicyViolationIngest(
            run_id=run_id,
            engine_id=engine_id,
            policy_id=hit.policy_id,
            severity=hit.severity,  # type: ignore[arg-type]
            action=hit.action,  # type: ignore[arg-type]
            resource_type=hit.resource_type,
            resource=hit.resource,
            message=hit.message,
            ts=_utc_now(),
            context={"category": hit.category},
        )
        stored.append(engine_ingest.append_policy_violation(body))
    return stored


def enforce_or_raise(
    ctx: EvaluationContext,
    *,
    run_id: str,
    engine_id: str,
) -> PolicyEvaluation:
    evaluation = evaluate_context(ctx)
    if evaluation.hits:
        record_violations(evaluation, run_id=run_id, engine_id=engine_id)
    if not evaluation.allowed:
        raise PolicyEnforcementError(evaluation)
    return evaluation


def evaluate_run_event(body: RunEventIngest) -> PolicyEvaluation | None:
    payload = body.payload or {}
    roots = list(payload.get("workspace_roots") or [])
    run_id = body.run_id
    engine_id = body.engine_id

    if body.event_type == "tool_call":
        tool = str(payload.get("tool") or payload.get("tool_name") or payload.get("name") or "")
        return enforce_or_raise(
            EvaluationContext(kind="tool", resource=tool, run_id=run_id, engine_id=engine_id, workspace_roots=roots),
            run_id=run_id,
            engine_id=engine_id,
        )

    if body.event_type == "artifact_written":
        path = str(payload.get("path") or payload.get("artifact_path") or "")
        return enforce_or_raise(
            EvaluationContext(
                kind="artifact",
                resource=path,
                run_id=run_id,
                engine_id=engine_id,
                extra={"bytes": payload.get("bytes") or payload.get("size") or 0},
            ),
            run_id=run_id,
            engine_id=engine_id,
        )

    if body.event_type in {"run.completed", "run_finished"}:
        log_text = body.log_excerpt or str(payload.get("log_excerpt") or "")
        if log_text:
            return enforce_or_raise(
                EvaluationContext(
                    kind="text",
                    resource="log_excerpt",
                    run_id=run_id,
                    engine_id=engine_id,
                    extra={"text": log_text},
                ),
                run_id=run_id,
                engine_id=engine_id,
            )
    return None


def evaluate_run_complete(body: RunComplete, *, run_id: str) -> PolicyEvaluation | None:
    if body.log_excerpt:
        evaluation = enforce_or_raise(
            EvaluationContext(
                kind="text",
                resource="log_excerpt",
                run_id=run_id,
                engine_id=body.engine_id,
                extra={"text": body.log_excerpt},
            ),
            run_id=run_id,
            engine_id=body.engine_id,
        )
    else:
        evaluation = None

    for item in body.artifact_manifest:
        enforce_or_raise(
            EvaluationContext(
                kind="artifact",
                resource=item.path,
                run_id=run_id,
                engine_id=body.engine_id,
                extra={"bytes": item.bytes},
            ),
            run_id=run_id,
            engine_id=body.engine_id,
        )
    return evaluation
