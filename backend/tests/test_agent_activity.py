"""Agent activity audit aggregation tests (#204)."""
from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class AgentActivityAuditTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin",
            },
            clear=False,
        )
        self._env_patch.start()
        self._reset_stores()

    def tearDown(self) -> None:
        self._reset_stores()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _reset_stores(self) -> None:
        from infra import accounts, claude_agent_runs, gateway, mcp_registry

        accounts._conn = None  # noqa: SLF001
        claude_agent_runs._conn = None  # noqa: SLF001
        gateway._conn = None  # noqa: SLF001
        mcp_registry._conn = None  # noqa: SLF001

    def _client(self):
        from fastapi.testclient import TestClient
        import main

        importlib.reload(main)
        return TestClient(main.app)

    def test_aggregate_agent_activity(self) -> None:
        from infra import accounts, claude_agent_runs, gateway, mcp_registry

        account = accounts.create_account(name="Audit Alice")
        account_id = account["account_id"]

        run_ids: list[str] = []
        for idx in range(10):
            run = claude_agent_runs.create_run(
                agent_id=f"agent_{idx % 2}",
                account_id=account_id,
                prompt=f"prompt {idx}",
            )
            run_ids.append(run["run_id"])

        for idx in range(5):
            mcp_registry.record_mcp_call(
                "svc_demo",
                run_id=run_ids[idx],
                agent_id="agent_0",
                account_id=account_id,
                args=f"{{\"q\": {idx}}}",
                status="ok",
                result="done",
            )

        for idx in range(3):
            gateway.record_request(
                {
                    "request_id": f"req_{idx}",
                    "conversation_id": f"conv_{idx}",
                    "api_key_label": "alice-key",
                    "account_id": account_id,
                    "key_id": "key_1",
                    "agent_id": "agent_0",
                    "team_id": "",
                    "engine_id": "",
                    "model": "claude-sonnet",
                    "model_alias": "",
                    "status_code": 200,
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150,
                    "cost_usd": 0.01,
                    "latency_ms": 120,
                    "risk_status": "allowed",
                    "request_excerpt": "hello",
                    "response_excerpt": "world",
                    "error": "",
                    "user_message": "hello",
                }
            )

        client = self._client()
        res = client.get(
            "/api/v1/audit/agent-activity",
            headers={"X-Admin-Token": "test-admin"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["total_accounts"], 1)
        summary = body["summary"]
        self.assertEqual(len(summary), 1)
        row = summary[0]
        self.assertEqual(row["account_id"], account_id)
        self.assertEqual(row["account_name"], "Audit Alice")
        self.assertEqual(row["run_count"], 10)
        self.assertEqual(row["mcp_calls"], 5)
        self.assertEqual(row["gateway_requests"], 3)
        self.assertEqual(row["total_tokens"], 450)

        runs_res = client.get(
            f"/api/v1/audit/agent-activity/runs?account_id={account_id}",
            headers={"X-Admin-Token": "test-admin"},
        )
        self.assertEqual(runs_res.status_code, 200)
        runs_body = runs_res.json()
        self.assertEqual(runs_body["total"], 10)
        self.assertTrue(any(run["mcp_calls"] == 1 for run in runs_body["runs"]))

        mcp_res = client.get(
            f"/api/v1/audit/agent-activity/mcp?run_id={run_ids[0]}",
            headers={"X-Admin-Token": "test-admin"},
        )
        self.assertEqual(mcp_res.status_code, 200)
        self.assertEqual(len(mcp_res.json()["calls"]), 1)

        timeline_res = client.get(
            f"/api/v1/audit/agent-activity/timeline?account_id={account_id}&limit=50",
            headers={"X-Admin-Token": "test-admin"},
        )
        self.assertEqual(timeline_res.status_code, 200)
        events = timeline_res.json()["events"]
        kinds = {event["kind"] for event in events}
        self.assertIn("run", kinds)
        self.assertIn("mcp", kinds)
        self.assertIn("gateway", kinds)


if __name__ == "__main__":
    unittest.main()
