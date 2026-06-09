"""Hosted Claude coding agent workspace and run tests."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class CodingAgentApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin",
                "EVOTOWN_CLAUDE_CODE_COMMAND": "",
                "EVOTOWN_CLAUDE_EXECUTION_MODE": "dry-run",
                "ANTHROPIC_API_KEY": "",
            },
            clear=False,
        )
        self._env_patch.start()
        from infra import accounts, claude_agent_runs, knowledge, skill_market, workspaces

        accounts._conn = None  # noqa: SLF001
        claude_agent_runs._conn = None  # noqa: SLF001
        knowledge._conn = None  # noqa: SLF001
        skill_market._conn = None  # noqa: SLF001
        workspaces._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import accounts, claude_agent_runs, knowledge, skill_market, workspaces

        accounts._conn = None  # noqa: SLF001
        claude_agent_runs._conn = None  # noqa: SLF001
        knowledge._conn = None  # noqa: SLF001
        skill_market._conn = None  # noqa: SLF001
        workspaces._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        return TestClient(main.app)

    def _account_key(self, name: str) -> tuple[dict, str]:
        from infra import accounts

        account = accounts.create_account(name=name)
        _key, secret = accounts.create_api_key(
            account["account_id"],
            label=f"{name}-console",
            scopes=list(accounts.DEFAULT_CONSOLE_KEY_SCOPES),
        )
        return account, secret

    def test_workspace_owner_isolation_and_path_guard(self) -> None:
        from infra import workspaces

        client = self._client()
        alice, alice_key = self._account_key("Alice")
        _bob, bob_key = self._account_key("Bob")

        create = client.post(
            "/api/v1/workspaces",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={"name": "Alice Sandbox"},
        )
        self.assertEqual(create.status_code, 200)
        workspace = create.json()["workspace"]
        self.assertEqual(workspace["owner_account_id"], alice["account_id"])

        denied = client.get(
            f"/api/v1/workspaces/{workspace['workspace_id']}",
            headers={"Authorization": f"Bearer {bob_key}"},
        )
        self.assertEqual(denied.status_code, 403)

        with self.assertRaises(ValueError):
            workspaces.resolve_workspace_path(workspace, "../escape.txt")

    def test_create_run_and_runner_writes_shared_context(self) -> None:
        from infra import claude_agent_runs, workspaces
        from services import claude_code_runner

        client = self._client()
        _alice, alice_key = self._account_key("Alice")
        with patch("services.claude_code_runner.schedule_run", lambda run_id: None):
            create_ws = client.post(
                "/api/v1/workspaces",
                headers={"Authorization": f"Bearer {alice_key}"},
                json={"name": "Coding Sandbox"},
            )
            self.assertEqual(create_ws.status_code, 200)
            workspace = create_ws.json()["workspace"]

            create_run = client.post(
                f"/api/v1/workspaces/{workspace['workspace_id']}/runs",
                headers={"Authorization": f"Bearer {alice_key}"},
                json={"prompt": "Summarize the Evotown workspace context.", "model": "claude-test"},
            )
            self.assertEqual(create_run.status_code, 200)
            run_id = create_run.json()["run"]["run_id"]
            self.assertEqual(create_run.json()["run"]["status"], "queued")

        updated = asyncio.run(claude_code_runner.run_claude_agent(run_id))
        self.assertEqual(updated["status"], "succeeded")
        self.assertTrue(updated["signals"]["sdk_command_configured"] is False)

        stored_workspace = workspaces.get_workspace(workspace["workspace_id"])
        assert stored_workspace is not None
        context_path = Path(stored_workspace["root_path"]) / ".evotown" / "AGENT_CONTEXT.md"
        skills_path = Path(stored_workspace["root_path"]) / ".evotown" / "skills_manifest.json"
        knowledge_path = Path(stored_workspace["root_path"]) / ".evotown" / "knowledge_context.json"
        self.assertTrue(context_path.is_file())
        self.assertTrue(skills_path.is_file())
        self.assertTrue(knowledge_path.is_file())

        events = claude_agent_runs.list_events(run_id)
        event_types = [event["event_type"] for event in events]
        self.assertIn("context.ready", event_types)
        self.assertIn("run.succeeded", event_types)

        fetched = client.get(
            f"/api/v1/agent-runs/{run_id}",
            headers={"Authorization": f"Bearer {alice_key}"},
        )
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["run"]["status"], "succeeded")

    def test_runner_injects_selected_skills_and_mcp(self) -> None:
        from infra import claude_agent_runs, workspaces
        from services import claude_code_runner

        client = self._client()
        _alice, alice_key = self._account_key("Alice")
        with patch("services.claude_code_runner.schedule_run", lambda run_id: None):
            workspace = client.post(
                "/api/v1/workspaces",
                headers={"Authorization": f"Bearer {alice_key}"},
                json={"name": "Inject Sandbox"},
            ).json()["workspace"]
            create_run = client.post(
                f"/api/v1/workspaces/{workspace['workspace_id']}/runs",
                headers={"Authorization": f"Bearer {alice_key}"},
                json={
                    "prompt": "Use http-request skill and query demo database.",
                    "model": "claude-test",
                    "skills": ["http-request"],
                    "mcp": ["demo-sqlite"],
                },
            )
            self.assertEqual(create_run.status_code, 200)
            run_id = create_run.json()["run"]["run_id"]

        with patch(
            "services.claude_code_runner._resolve_mcp_context",
            return_value={
                "selection_mode": "explicit",
                "connections": [
                    {
                        "connection_id": "demo-sqlite",
                        "name": "Demo SQLite",
                        "db_type": "sqlite",
                        "mcp_server_url": "http://localhost:9100",
                        "permission": "read",
                        "usage": "test",
                    }
                ],
                "tool_skill": "database-query",
            },
        ):
            updated = asyncio.run(claude_code_runner.run_claude_agent(run_id))

        self.assertEqual(updated["status"], "succeeded")
        self.assertEqual(updated["signals"]["materialized_skill_count"], 1)
        self.assertEqual(updated["signals"]["mcp_connection_count"], 1)

        stored_workspace = workspaces.get_workspace(workspace["workspace_id"])
        assert stored_workspace is not None
        root = Path(stored_workspace["root_path"])
        self.assertTrue((root / ".evotown" / "mcp_context.json").is_file())
        self.assertTrue((root / ".evotown" / "skills" / "http-request" / "SKILL.md").is_file())
        mcp_payload = json.loads((root / ".evotown" / "mcp_context.json").read_text(encoding="utf-8"))
        self.assertEqual(mcp_payload["connections"][0]["connection_id"], "demo-sqlite")
        self.assertTrue((root / ".mcp.json").is_file())

        ready = next(e for e in claude_agent_runs.list_events(run_id) if e["event_type"] == "context.ready")
        self.assertEqual(ready["payload"]["materialized_skills"], 1)
        self.assertEqual(ready["payload"]["mcp_connections"], 1)

    def test_runner_prefers_embedded_sdk_when_available(self) -> None:
        from services import claude_code_runner

        client = self._client()
        _alice, alice_key = self._account_key("Alice")
        with patch("services.claude_code_runner.schedule_run", lambda run_id: None):
            workspace = client.post(
                "/api/v1/workspaces",
                headers={"Authorization": f"Bearer {alice_key}"},
                json={"name": "SDK Sandbox"},
            ).json()["workspace"]
            create_run = client.post(
                f"/api/v1/workspaces/{workspace['workspace_id']}/runs",
                headers={"Authorization": f"Bearer {alice_key}"},
                json={"prompt": "Add a comment to README.md", "model": "claude-sonnet-4"},
            )
            run_id = create_run.json()["run"]["run_id"]

        with (
            patch.dict(os.environ, {"EVOTOWN_CLAUDE_EXECUTION_MODE": "sdk"}, clear=False),
            patch("services.claude_agent_sdk_runner.sdk_available", return_value=True),
            patch(
                "services.claude_agent_sdk_runner.run_agent_sdk",
                new=AsyncMock(return_value=(0, "Updated README via embedded SDK.")),
            ),
        ):
            updated = asyncio.run(claude_code_runner.run_claude_agent(run_id))

        self.assertEqual(updated["status"], "succeeded")
        self.assertEqual(updated["signals"]["execution_backend"], "sdk")
        self.assertTrue(updated["signals"]["sdk_command_configured"])
        self.assertIn("embedded SDK", updated["result_summary"])


if __name__ == "__main__":
    unittest.main()
