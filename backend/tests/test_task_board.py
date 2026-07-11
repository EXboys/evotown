"""Task board API — unified dispatch + hosted run Kanban."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch


class TaskBoardApiTest(unittest.TestCase):
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
        from pathlib import Path
        from infra import engine_ingest, claude_agent_runs, task_nodes, agents, accounts

        engine_ingest._conn = None
        engine_ingest._DATA_DIR = Path(self._tmpdir.name)
        engine_ingest._DB_PATH = Path(self._tmpdir.name) / "engine_ingest.db"
        claude_agent_runs._conn = None
        task_nodes._conn = None
        agents._conn = None
        accounts._conn = None

    def tearDown(self) -> None:
        from infra import engine_ingest, claude_agent_runs, task_nodes, agents, accounts

        engine_ingest._conn = None
        claude_agent_runs._conn = None
        task_nodes._conn = None
        agents._conn = None
        accounts._conn = None
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        return TestClient(main.app)

    def test_task_board_shows_dispatch_and_run(self) -> None:
        from domain.models import DispatchJobCreate
        from infra import agent_dispatch, claude_agent_runs, agents, accounts, hosted_agent_engines

        client = self._client()
        admin = {"X-Admin-Token": "test-admin"}

        account = accounts.create_account(name="board-owner", role="admin")
        agent = agents.create_agent(account_id=account["account_id"], name="Board Agent")
        agent_id = agent["agent_id"]
        hosted_agent_engines.register_agent_engine(agent)

        job = agent_dispatch.create_job(
            DispatchJobCreate(
                kind="dispatch",
                target_engine_id=hosted_agent_engines.engine_id_for_agent(agent_id),
                title="Review PR",
                message="Check the latest pull request",
            ),
        )

        run = claude_agent_runs.create_run(
            agent_id=agent_id,
            account_id=account["account_id"],
            prompt="Standalone run",
            signals={"source": "manual"},
        )
        claude_agent_runs.update_run_status(run["run_id"], status="running")

        resp = client.get(f"/api/v1/task-board?agent_id={agent_id}", headers=admin)
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["agent_id"], agent_id)
        columns = body["columns"]
        self.assertGreaterEqual(body["total"], 2)
        self.assertIn("has_more", body)
        self.assertIn("limit", body)
        for status_nodes in body["columns"].values():
            for node in status_nodes:
                if node.get("agent_id") == agent_id:
                    self.assertEqual(node.get("agent_name"), "Board Agent")

        queued_ids = {n["source_id"] for n in columns["queued"]}
        running_ids = {n["source_id"] for n in columns["running"]}
        self.assertIn(job["job_id"], queued_ids)
        self.assertIn(run["run_id"], running_ids)

    def test_task_board_filters_by_agent(self) -> None:
        from domain.models import DispatchJobCreate
        from infra import agent_dispatch, agents, accounts, hosted_agent_engines

        client = self._client()
        admin = {"X-Admin-Token": "test-admin"}

        account = accounts.create_account(name="filter-owner", role="admin")
        agent_a = agents.create_agent(account_id=account["account_id"], name="Agent A")
        agent_b = agents.create_agent(account_id=account["account_id"], name="Agent B")
        hosted_agent_engines.register_agent_engine(agent_a)
        hosted_agent_engines.register_agent_engine(agent_b)

        agent_dispatch.create_job(
            DispatchJobCreate(
                kind="dispatch",
                target_engine_id=hosted_agent_engines.engine_id_for_agent(agent_a["agent_id"]),
                title="A task",
                message="Only for A",
            ),
        )
        agent_dispatch.create_job(
            DispatchJobCreate(
                kind="dispatch",
                target_engine_id=hosted_agent_engines.engine_id_for_agent(agent_b["agent_id"]),
                title="B task",
                message="Only for B",
            ),
        )

        resp = client.get(f"/api/v1/task-board?agent_id={agent_a['agent_id']}", headers=admin)
        self.assertEqual(resp.status_code, 200, resp.text)
        columns = resp.json()["columns"]
        all_nodes = [n for group in columns.values() for n in group]
        self.assertTrue(all_nodes)
        self.assertTrue(all(node["agent_id"] == agent_a["agent_id"] for node in all_nodes))

    def test_dispatch_run_completion_moves_column(self) -> None:
        from domain.models import DispatchJobCreate, DispatchJobComplete
        from infra import agent_dispatch, claude_agent_runs, agents, accounts, hosted_agent_engines, task_nodes

        client = self._client()
        admin = {"X-Admin-Token": "test-admin"}

        account = accounts.create_account(name="flow-owner", role="admin")
        agent = agents.create_agent(account_id=account["account_id"], name="Flow Agent")
        agent_id = agent["agent_id"]
        hosted_agent_engines.register_agent_engine(agent)

        job = agent_dispatch.create_job(
            DispatchJobCreate(
                kind="dispatch",
                target_engine_id=hosted_agent_engines.engine_id_for_agent(agent_id),
                title="Finish me",
                message="Complete this job",
            ),
        )
        run = claude_agent_runs.create_run(
            agent_id=agent_id,
            account_id=account["account_id"],
            prompt=job["message"],
            signals={"dispatch_job_id": job["job_id"]},
        )
        agent_dispatch.complete_job(
            job["job_id"],
            DispatchJobComplete(
                engine_id=hosted_agent_engines.engine_id_for_agent(agent_id),
                status="succeeded",
                run_id=run["run_id"],
                result_summary="done",
            ),
        )
        claude_agent_runs.update_run_status(run["run_id"], status="succeeded")

        task_nodes.sync_recent()
        node = task_nodes.upsert_from_dispatch_job(agent_dispatch.get_job(job["job_id"]) or {})
        self.assertEqual(node["board_status"], "done")

        resp = client.get(f"/api/v1/task-board?agent_id={agent_id}", headers=admin)
        done_ids = {n["source_id"] for n in resp.json()["columns"]["done"]}
        self.assertIn(job["job_id"], done_ids)
