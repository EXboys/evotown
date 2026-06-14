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

    def test_workspace_profile_crud_and_run_injection(self) -> None:
        from services import claude_code_runner

        client = self._client()
        _alice, alice_key = self._account_key("Alice")
        create_ws = client.post(
            "/api/v1/workspaces",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={"name": "Profile Sandbox"},
        )
        self.assertEqual(create_ws.status_code, 200)
        workspace = create_ws.json()["workspace"]
        ws_id = workspace["workspace_id"]

        empty = client.get(
            f"/api/v1/workspaces/{ws_id}/profile",
            headers={"Authorization": f"Bearer {alice_key}"},
        )
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.json()["profile"]["agent_type"], "")

        save = client.put(
            f"/api/v1/workspaces/{ws_id}/profile",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={
                "agent_type": "code-reviewer",
                "soul": "You are a strict code reviewer.",
                "paradigm": "Read diff first, then comment.",
                "standards": "Use conventional commits.",
                "default_model": "claude-test",
                "default_skills": ["http-request"],
                "default_mcp": [],
            },
        )
        self.assertEqual(save.status_code, 200)
        self.assertEqual(save.json()["profile"]["agent_type"], "code-reviewer")

        with patch("services.claude_code_runner.schedule_run", lambda run_id: None):
            create_run = client.post(
                f"/api/v1/workspaces/{ws_id}/runs",
                headers={"Authorization": f"Bearer {alice_key}"},
                json={"prompt": "Review this patch."},
            )
            self.assertEqual(create_run.status_code, 200)
            run = create_run.json()["run"]
            self.assertEqual(run["model"], "claude-test")
            self.assertEqual(run["signals"]["selected_skills"], ["http-request"])
            run_id = run["run_id"]

        updated = asyncio.run(claude_code_runner.run_claude_agent(run_id))
        self.assertEqual(updated["status"], "succeeded")
        context = Path(workspace["root_path"]) / ".evotown" / "AGENT_CONTEXT.md"
        profile_md = Path(workspace["root_path"]) / ".evotown" / "AGENT_PROFILE.md"
        self.assertTrue(context.is_file())
        self.assertTrue(profile_md.is_file())
        text = context.read_text(encoding="utf-8")
        self.assertIn("code-reviewer", text)
        self.assertIn("strict code reviewer", text)
        self.assertIn("conventional commits", text)

    def test_workspace_file_index_lists_relative_paths_only(self) -> None:
        client = self._client()
        _alice, alice_key = self._account_key("Alice")
        create_ws = client.post(
            "/api/v1/workspaces",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={"name": "Files Sandbox"},
        )
        workspace = create_ws.json()["workspace"]
        ws_id = workspace["workspace_id"]
        root = Path(workspace["root_path"])
        (root / "notes.md").write_text("# hello", encoding="utf-8")
        (root / ".evotown" / "hidden.json").write_text("{}", encoding="utf-8")

        listed = client.get(
            f"/api/v1/workspaces/{ws_id}/file-index",
            headers={"Authorization": f"Bearer {alice_key}"},
        )
        self.assertEqual(listed.status_code, 200)
        paths = [item["path"] for item in listed.json()["entries"]]
        self.assertIn("README.md", paths)
        self.assertIn("notes.md", paths)
        self.assertTrue(all(not p.startswith("/") for p in paths))
        self.assertFalse(any(p.startswith(".evotown/") for p in paths))

        with_dot = client.get(
            f"/api/v1/workspaces/{ws_id}/file-index?include_dot=true",
            headers={"Authorization": f"Bearer {alice_key}"},
        )
        dot_paths = [item["path"] for item in with_dot.json()["entries"]]
        self.assertTrue(any(p.startswith(".evotown/") for p in dot_paths))

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

    def test_runner_gateway_env_marks_sdk_ready(self) -> None:
        from services import claude_agent_sdk_runner, claude_code_runner

        with (
            patch.dict(
                os.environ,
                {
                    "ANTHROPIC_API_KEY": "",
                    "EVOTOWN_CLAUDE_EXECUTION_MODE": "auto",
                    "EVOTOWN_CLAUDE_USE_GATEWAY": "1",
                    "EVOTOWN_CLAUDE_GATEWAY_BASE_URL": "http://backend:8000/api/gateway/anthropic/",
                    "EVOTOWN_CLAUDE_GATEWAY_API_KEY": "evk_test",
                },
                clear=False,
            ),
            patch("services.claude_agent_sdk_runner.sdk_available", return_value=True),
        ):
            self.assertEqual(claude_code_runner._execution_backend(), "sdk")  # noqa: SLF001
            env = claude_agent_sdk_runner.gateway_sdk_env()

        self.assertEqual(env["ANTHROPIC_BASE_URL"], "http://backend:8000/api/gateway/anthropic")
        self.assertEqual(env["ANTHROPIC_API_KEY"], "evk_test")
        self.assertEqual(env["CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"], "1")

    def test_cli_subprocess_env_uses_gateway_base(self) -> None:
        from services import claude_code_runner

        with patch.dict(
            os.environ,
            {
                "EVOTOWN_CLAUDE_USE_GATEWAY": "1",
                "EVOTOWN_CLAUDE_GATEWAY_BASE_URL": "http://backend:8765/api/gateway/anthropic",
                "EVOTOWN_CLAUDE_GATEWAY_API_KEY": "evk_test",
            },
            clear=False,
        ):
            env = claude_code_runner._cli_subprocess_env(  # noqa: SLF001
                workspace_root=Path("/tmp/ws"),
                run={"run_id": "car_test", "prompt": "hi", "signals": {}},
                model="deepseek-v4-flash",
            )
        self.assertEqual(env["ANTHROPIC_BASE_URL"], "http://backend:8765/api/gateway/anthropic")
        self.assertEqual(env["ANTHROPIC_API_KEY"], "evk_test")

    def test_cancel_run_marks_cancelled(self) -> None:
        from infra import claude_agent_runs, workspaces
        from services import claude_code_runner

        account, secret = self._account_key("CancelUser")
        ws = workspaces.create_workspace(owner_account_id=account["account_id"], name="Cancel WS")
        run = claude_agent_runs.create_run(
            workspace_id=ws["workspace_id"],
            account_id=account["account_id"],
            prompt="slow task",
            model="claude-sonnet-4",
        )
        claude_agent_runs.update_run_status(run["run_id"], status="running")

        updated = asyncio.run(claude_code_runner.cancel_run(run["run_id"]))
        self.assertIsNotNone(updated)
        assert updated is not None
        self.assertEqual(updated["status"], "cancelled")

    def test_list_stale_active_runs(self) -> None:
        from infra import claude_agent_runs, workspaces

        account, _secret = self._account_key("StaleUser")
        ws = workspaces.create_workspace(owner_account_id=account["account_id"], name="Stale WS")
        run = claude_agent_runs.create_run(
            workspace_id=ws["workspace_id"],
            account_id=account["account_id"],
            prompt="stale",
            model="claude-sonnet-4",
        )
        claude_agent_runs.update_run_status(run["run_id"], status="running")
        conn = claude_agent_runs._ensure_conn()  # noqa: SLF001
        conn.execute(
            "UPDATE claude_agent_runs SET started_at=datetime('now', '-700 seconds') WHERE run_id=?",
            (run["run_id"],),
        )
        conn.commit()
        stale = claude_agent_runs.list_stale_active_runs(timeout_sec=600)
        self.assertTrue(any(item["run_id"] == run["run_id"] for item in stale))

    def test_delete_session_removes_run_chain(self) -> None:
        from infra import claude_agent_runs, workspaces

        client = self._client()
        account, secret = self._account_key("DeleteSessionUser")
        ws = workspaces.create_workspace(owner_account_id=account["account_id"], name="Delete WS")
        workspace_id = ws["workspace_id"]

        first = client.post(
            f"/api/v1/workspaces/{workspace_id}/runs",
            headers={"Authorization": f"Bearer {secret}"},
            json={"prompt": "first turn", "model": "claude-test"},
        )
        self.assertEqual(first.status_code, 200)
        run1 = first.json()["run"]["run_id"]

        second = client.post(
            f"/api/v1/workspaces/{workspace_id}/runs",
            headers={"Authorization": f"Bearer {secret}"},
            json={"prompt": "second turn", "model": "claude-test", "previous_run_id": run1},
        )
        self.assertEqual(second.status_code, 200)
        run2 = second.json()["run"]["run_id"]

        deleted = client.delete(
            f"/api/v1/workspaces/{workspace_id}/sessions/{run1}",
            headers={"Authorization": f"Bearer {secret}"},
        )
        self.assertEqual(deleted.status_code, 200)
        body = deleted.json()
        self.assertEqual(body["deleted_count"], 2)
        self.assertIn(run1, body["deleted_run_ids"])
        self.assertIn(run2, body["deleted_run_ids"])
        self.assertIsNone(claude_agent_runs.get_run(run1))
        self.assertIsNone(claude_agent_runs.get_run(run2))

    def test_upload_files_and_create_run_with_attachments(self) -> None:
        from infra import claude_agent_runs, workspaces

        client = self._client()
        account, secret = self._account_key("UploadUser")
        ws = workspaces.create_workspace(owner_account_id=account["account_id"], name="Upload WS")
        workspace_id = ws["workspace_id"]
        headers = {"Authorization": f"Bearer {secret}"}

        uploaded = client.post(
            f"/api/v1/workspaces/{workspace_id}/uploads",
            headers=headers,
            files=[
                ("files", ("note.txt", b"hello attachment", "text/plain")),
                ("files", ("photo.png", b"\x89PNG\r\n\x1a\n", "image/png")),
            ],
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        uploads = uploaded.json()["uploads"]
        self.assertEqual(len(uploads), 2)
        paths = [item["path"] for item in uploads]
        self.assertTrue(all(path.startswith("uploads/") for path in paths))

        created = client.post(
            f"/api/v1/workspaces/{workspace_id}/runs",
            headers=headers,
            json={
                "prompt": "请阅读附件",
                "model": "claude-test",
                "attachments": paths,
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        run = created.json()["run"]
        self.assertEqual(run["signals"]["attachments"], paths)

        invalid = client.post(
            f"/api/v1/workspaces/{workspace_id}/runs",
            headers=headers,
            json={"prompt": "bad path", "model": "claude-test", "attachments": ["../README.md"]},
        )
        self.assertEqual(invalid.status_code, 400)


class ClaudeRunModelResolveTest(unittest.TestCase):
    def test_resolve_run_model_prefers_explicit(self) -> None:
        from services import claude_code_runner

        self.assertEqual(claude_code_runner.resolve_run_model("deepseek-v4-flash"), "deepseek-v4-flash")
        self.assertEqual(claude_code_runner.resolve_run_model("  custom  "), "custom")

    def test_default_model_falls_back_to_catalog(self) -> None:
        from services import claude_code_runner

        models = claude_code_runner.list_available_models()
        self.assertTrue(models)
        self.assertEqual(claude_code_runner.default_model_id(), models[0]["id"])
        self.assertEqual(claude_code_runner.resolve_run_model(None), models[0]["id"])


if __name__ == "__main__":
    unittest.main()
