"""Policy evaluator and enforcement API tests."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from domain.policy.evaluator import PolicyEvaluator
from domain.policy.types import EvaluationContext
from infra import policies


class PolicyEvaluatorUnitTest(unittest.TestCase):
    def setUp(self) -> None:
        self.evaluator = PolicyEvaluator(policies._DEFAULT_POLICIES)  # noqa: SLF001

    def test_deny_tool_blocked(self) -> None:
        result = self.evaluator.evaluate(
            EvaluationContext(kind="tool", resource="shell_rm_rf")
        )
        self.assertFalse(result.allowed)
        self.assertEqual(result.action, "blocked")
        self.assertTrue(any(hit.policy_id == "tool-allowlist" for hit in result.hits))

    def test_network_not_in_allowlist_blocked(self) -> None:
        result = self.evaluator.evaluate(
            EvaluationContext(kind="network", resource="https://evil.example.com/api")
        )
        self.assertFalse(result.allowed)
        self.assertEqual(result.action, "blocked")

    def test_network_allowlisted_ok(self) -> None:
        result = self.evaluator.evaluate(
            EvaluationContext(kind="network", resource="https://api.openai.com/v1/chat")
        )
        self.assertTrue(result.allowed)

    def test_workspace_outside_root_blocked(self) -> None:
        result = self.evaluator.evaluate(
            EvaluationContext(kind="file_read", resource="/etc/passwd")
        )
        self.assertFalse(result.allowed)

    def test_workspace_ssh_denied(self) -> None:
        home = os.path.expanduser("~")
        result = self.evaluator.evaluate(
            EvaluationContext(kind="file_read", resource=f"{home}/.ssh/id_rsa")
        )
        self.assertFalse(result.allowed)

    def test_require_approval_tool_warned(self) -> None:
        result = self.evaluator.evaluate(
            EvaluationContext(kind="tool", resource="filesystem_write")
        )
        self.assertTrue(result.allowed)
        self.assertEqual(result.action, "warned")

    def test_artifact_too_large_blocked(self) -> None:
        result = self.evaluator.evaluate(
            EvaluationContext(
                kind="artifact",
                resource="bundle.zip",
                extra={"bytes": 100_000_000},
            )
        )
        self.assertFalse(result.allowed)

    def test_secret_in_text_blocked_when_configured(self) -> None:
        result = self.evaluator.evaluate(
            EvaluationContext(
                kind="text",
                resource="log",
                extra={"text": "Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz"},
            )
        )
        self.assertFalse(result.allowed)
        self.assertIsNotNone(result.redacted_text)
        self.assertNotIn("sk-abc", result.redacted_text or "")


class PolicyEvaluateApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin-token",
            },
            clear=False,
        )
        self._env_patch.start()
        self._dotenv_patch = patch("dotenv.load_dotenv")
        self._dotenv_patch.start()
        policies._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        policies._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_evaluate_endpoint_blocks_deny_tool(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        res = client.post(
            "/api/v1/policy/evaluate",
            headers={"X-Admin-Token": "test-admin-token"},
            json={"kind": "tool", "resource": "shell_rm_rf"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertFalse(body["allowed"])
        self.assertEqual(body["action"], "blocked")

    def test_ingest_tool_call_blocked(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main
        from infra import engine_ingest

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}

        reg = client.post(
            "/api/v1/engines/register",
            headers=admin,
            json={
                "engine_id": "policy-test-eng",
                "engine_version": "1",
                "engine_type": "openclaw",
            },
        )
        ingest = reg.json()["ingest_token"]

        started = client.post(
            "/api/v1/events",
            headers={"Authorization": f"Bearer {ingest}"},
            json={
                "run_id": "run-policy-1",
                "engine_id": "policy-test-eng",
                "event_type": "run.started",
                "ts": "2026-05-27T00:00:00Z",
                "seq": 0,
            },
        )
        self.assertEqual(started.status_code, 200)

        blocked = client.post(
            "/api/v1/events",
            headers={"Authorization": f"Bearer {ingest}"},
            json={
                "run_id": "run-policy-1",
                "engine_id": "policy-test-eng",
                "event_type": "tool_call",
                "ts": "2026-05-27T00:00:01Z",
                "seq": 1,
                "payload": {"tool": "shell_rm_rf"},
            },
        )
        self.assertEqual(blocked.status_code, 403)

        violations = engine_ingest.list_policy_violations(run_id="run-policy-1")
        self.assertGreaterEqual(len(violations), 1)


if __name__ == "__main__":
    unittest.main()
