"""Hosted coding workspace dispatch bridge tests."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class HostedDispatchTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin",
                "EVOTOWN_ENGINE_INGEST_TOKEN": "test-ingest",
                "EVOTOWN_CLAUDE_CODE_COMMAND": "",
            },
            clear=False,
        )
        self._env_patch.start()
        from infra import accounts, claude_agent_runs, engine_ingest, agents

        accounts._conn = None  # noqa: SLF001
        claude_agent_runs._conn = None  # noqa: SLF001
        engine_ingest._conn = None  # noqa: SLF001
        engine_ingest._DATA_DIR = Path(self._tmpdir.name)
        engine_ingest._DB_PATH = Path(self._tmpdir.name) / "engine_ingest.db"
        agents._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import accounts, claude_agent_runs, engine_ingest, agents

        accounts._conn = None  # noqa: SLF001
        claude_agent_runs._conn = None  # noqa: SLF001
        engine_ingest._conn = None  # noqa: SLF001
        agents._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        return TestClient(main.app)

    def test_workspace_registers_fleet_engine(self) -> None:
        from infra import hosted_agent_engines, agents

        agent = agents.create_agent(owner_account_id="acct-1", name="Dispatch Sandbox")
        engine_id = hosted_agent_engines.engine_id_for_agent(agent["agent_id"])

        client = self._client()
        fleet = client.get("/api/v1/engines/fleet", headers={"X-Admin-Token": "test-admin"})
        self.assertEqual(fleet.status_code, 200)
        engines = fleet.json().get("engines") or []
        match = next((e for e in engines if e.get("engine_id") == engine_id), None)
        self.assertIsNotNone(match)
        self.assertEqual(match.get("engine_type"), "hosted_coding")
        self.assertTrue(match.get("online"))

    def test_dispatch_job_runs_on_hosted_workspace(self) -> None:
        from infra import hosted_agent_engines, agents
        from services import hosted_dispatch_worker

        agent = agents.create_agent(owner_account_id="acct-dispatch", name="Job Target")
        engine_id = hosted_agent_engines.engine_id_for_agent(agent["agent_id"])

        client = self._client()
        admin = {"X-Admin-Token": "test-admin"}
        create = client.post(
            "/api/v1/jobs",
            headers=admin,
            json={
                "target_engine_id": engine_id,
                "title": "Fix bug",
                "message": "Inspect README and summarize the workspace.",
            },
        )
        self.assertEqual(create.status_code, 200)
        job_id = create.json()["job"]["job_id"]

        async def _fake_run(run_id: str):
            from infra import claude_agent_runs

            claude_agent_runs.update_run_status(
                run_id,
                status="succeeded",
                log_excerpt="done",
                result_summary="Workspace README summarized.",
            )
            return claude_agent_runs.get_run(run_id)

        with patch("services.claude_code_runner.run_claude_agent", side_effect=_fake_run):
            import asyncio

            handled = asyncio.run(hosted_dispatch_worker.process_next_hosted_job())
            self.assertTrue(handled)

        job = client.get(f"/api/v1/jobs/{job_id}", headers=admin).json()["job"]
        self.assertEqual(job["status"], "completed")
        self.assertIn("README", job.get("result_summary") or "")
        self.assertTrue(str(job.get("run_id") or "").startswith("car_"))

    def test_dispatch_payload_model_is_used(self) -> None:
        from infra import claude_agent_runs, hosted_agent_engines, agents
        from services import hosted_dispatch_worker

        agent = agents.create_agent(owner_account_id="acct-model", name="Model Target")
        engine_id = hosted_agent_engines.engine_id_for_agent(agent["agent_id"])

        client = self._client()
        admin = {"X-Admin-Token": "test-admin"}
        create = client.post(
            "/api/v1/jobs",
            headers=admin,
            json={
                "target_engine_id": engine_id,
                "message": "hello",
                "payload": {"model": "deepseek-v4-flash"},
            },
        )
        self.assertEqual(create.status_code, 200)
        captured: dict[str, str] = {}

        async def _fake_run(run_id: str):
            run = claude_agent_runs.get_run(run_id) or {}
            captured["model"] = str(run.get("model") or "")
            claude_agent_runs.update_run_status(
                run_id,
                status="succeeded",
                log_excerpt="ok",
                result_summary="ok",
            )
            return claude_agent_runs.get_run(run_id)

        with patch("services.claude_code_runner.run_claude_agent", side_effect=_fake_run):
            import asyncio

            handled = asyncio.run(hosted_dispatch_worker.process_next_hosted_job())
            self.assertTrue(handled)

        self.assertEqual(captured.get("model"), "deepseek-v4-flash")

    def test_archived_workspace_rejects_dispatch_target(self) -> None:
        from infra import hosted_agent_engines, agents

        agent = agents.create_agent(owner_account_id="acct-arch", name="Archived")
        engine_id = hosted_agent_engines.engine_id_for_agent(agent["agent_id"])
        agents.update_agent(agent["agent_id"], status=agents.AGENT_STATUS_ARCHIVED)

        client = self._client()
        admin = {"X-Admin-Token": "test-admin"}
        create = client.post(
            "/api/v1/jobs",
            headers=admin,
            json={
                "target_engine_id": engine_id,
                "title": "Should fail",
                "message": "noop",
            },
        )
        self.assertEqual(create.status_code, 422)
