"""Agent dispatch queue API."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch


class AgentDispatchApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin",
                "EVOTOWN_ENGINE_INGEST_TOKEN": "test-ingest",
                "EVOTOWN_DISPATCH_TEAM_PAIRS": "sales:finance",
            },
            clear=False,
        )
        self._env_patch.start()
        from infra import engine_ingest

        engine_ingest._conn = None

    def tearDown(self) -> None:
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        return TestClient(main.app)

    def _register_pair(self, client, ingest):
        client.post(
            "/api/v1/engines/register",
            headers=ingest,
            json={
                "engine_id": "openclaw-alice",
                "engine_type": "openclaw",
                "engine_version": "1.0.0",
                "owner_team": "sales",
            },
        )
        client.post(
            "/api/v1/engines/register",
            headers=ingest,
            json={
                "engine_id": "hermes-bob",
                "engine_type": "hermes",
                "engine_version": "1.0.0",
                "owner_team": "finance",
            },
        )

    def test_dispatch_lease_and_complete(self) -> None:
        client = self._client()
        ingest = {"Authorization": "Bearer test-ingest"}
        admin = {"X-Admin-Token": "test-admin"}
        self._register_pair(client, ingest)

        create = client.post(
            "/api/v1/jobs",
            headers=admin,
            json={
                "kind": "dispatch",
                "target_engine_id": "openclaw-alice",
                "title": "Review",
                "message": "Summarize the attached report.",
            },
        )
        self.assertEqual(create.status_code, 200)
        job_id = create.json()["job"]["job_id"]

        lease = client.get("/api/v1/jobs/lease?engine_id=openclaw-alice", headers=ingest)
        self.assertEqual(lease.status_code, 200)
        self.assertEqual(lease.json()["job_id"], job_id)

        wrong = client.get("/api/v1/jobs/lease?engine_id=hermes-bob", headers=ingest)
        self.assertEqual(wrong.status_code, 204)

        ack = client.post(
            f"/api/v1/jobs/{job_id}/ack",
            headers=ingest,
            json={"engine_id": "openclaw-alice"},
        )
        self.assertEqual(ack.status_code, 200)

        done = client.post(
            f"/api/v1/jobs/{job_id}/complete",
            headers=ingest,
            json={
                "engine_id": "openclaw-alice",
                "status": "succeeded",
                "exit_code": 0,
                "result_summary": "ok",
            },
        )
        self.assertEqual(done.status_code, 200)
        self.assertEqual(done.json()["job"]["status"], "completed")

    def test_handoff_to_team(self) -> None:
        client = self._client()
        ingest = {"Authorization": "Bearer test-ingest"}
        self._register_pair(client, ingest)

        handoff = client.post(
            "/api/v1/jobs/from-engine",
            headers=ingest,
            json={
                "kind": "handoff",
                "source_engine_id": "openclaw-alice",
                "target_team_id": "finance",
                "message": "Please approve expense #42",
            },
        )
        self.assertEqual(handoff.status_code, 200)

        lease = client.get("/api/v1/jobs/lease?engine_id=hermes-bob", headers=ingest)
        self.assertEqual(lease.status_code, 200)
        self.assertIn("expense", lease.json()["message"])

    def test_handoff_policy_denied(self) -> None:
        client = self._client()
        ingest = {"Authorization": "Bearer test-ingest"}
        self._register_pair(client, ingest)

        denied = client.post(
            "/api/v1/jobs/from-engine",
            headers=ingest,
            json={
                "kind": "handoff",
                "source_engine_id": "openclaw-alice",
                "target_team_id": "legal",
                "message": "nope",
            },
        )
        self.assertEqual(denied.status_code, 422)

    def test_chain_handoff_on_complete(self) -> None:
        client = self._client()
        ingest = {"Authorization": "Bearer test-ingest"}
        admin = {"X-Admin-Token": "test-admin"}
        self._register_pair(client, ingest)

        create = client.post(
            "/api/v1/jobs",
            headers=admin,
            json={
                "kind": "dispatch",
                "target_engine_id": "openclaw-alice",
                "message": "step one",
                "payload": {
                    "on_success_handoff": {
                        "target_team_id": "finance",
                        "message": "step two for finance",
                    }
                },
            },
        )
        job_id = create.json()["job"]["job_id"]

        client.post(f"/api/v1/jobs/{job_id}/ack", headers=ingest, json={"engine_id": "openclaw-alice"})
        done = client.post(
            f"/api/v1/jobs/{job_id}/complete",
            headers=ingest,
            json={"engine_id": "openclaw-alice", "status": "succeeded", "exit_code": 0, "result_summary": "done"},
        )
        self.assertEqual(done.status_code, 200)
        follow = done.json().get("follow_up_job")
        self.assertIsNotNone(follow)
        self.assertEqual(follow.get("target_team_id"), "finance")

        lease = client.get("/api/v1/jobs/lease?engine_id=hermes-bob", headers=ingest)
        self.assertEqual(lease.status_code, 200)

    def test_cancel_job(self) -> None:
        client = self._client()
        ingest = {"Authorization": "Bearer test-ingest"}
        admin = {"X-Admin-Token": "test-admin"}
        self._register_pair(client, ingest)

        create = client.post(
            "/api/v1/jobs",
            headers=admin,
            json={"target_engine_id": "openclaw-alice", "message": "cancel me"},
        )
        job_id = create.json()["job"]["job_id"]
        cancel = client.post(f"/api/v1/jobs/{job_id}/cancel", headers=admin)
        self.assertEqual(cancel.status_code, 200)
        self.assertEqual(cancel.json()["job"]["status"], "cancelled")

        lease = client.get("/api/v1/jobs/lease?engine_id=openclaw-alice", headers=ingest)
        self.assertEqual(lease.status_code, 204)

    def test_heartbeat_and_fleet(self) -> None:
        client = self._client()
        ingest = {"Authorization": "Bearer test-ingest"}
        admin = {"X-Admin-Token": "test-admin"}

        client.post(
            "/api/v1/engines/register",
            headers=ingest,
            json={"engine_id": "eng-1", "engine_type": "openclaw", "engine_version": "1.0.0"},
        )
        hb = client.post(
            "/api/v1/engines/eng-1/heartbeat",
            headers=ingest,
            json={"connector_version": "test", "gateway_reachable": True},
        )
        self.assertEqual(hb.status_code, 200)
        self.assertTrue(hb.json()["engine"]["online"])

        fleet = client.get("/api/v1/engines/fleet", headers=admin)
        self.assertEqual(fleet.status_code, 200)
        self.assertTrue(any(e["engine_id"] == "eng-1" for e in fleet.json()["engines"]))


if __name__ == "__main__":
    unittest.main()
