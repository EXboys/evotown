"""Agent Doctor WebSocket presence + job.assign (protocol v1)."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch


class DoctorWsApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin",
                "EVOTOWN_ENGINE_INGEST_TOKEN": "test-ingest",
            },
            clear=False,
        )
        self._env_patch.start()
        from pathlib import Path
        from infra import doctor_nodes, engine_ingest

        engine_ingest._conn = None
        engine_ingest._DATA_DIR = Path(self._tmpdir.name)
        engine_ingest._DB_PATH = Path(self._tmpdir.name) / "engine_ingest.db"
        doctor_nodes.clear_all_sessions_for_tests()

    def tearDown(self) -> None:
        from infra import doctor_nodes, engine_ingest

        doctor_nodes.clear_all_sessions_for_tests()
        engine_ingest._conn = None
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        os.environ["ADMIN_TOKEN"] = os.environ.get("ADMIN_TOKEN") or "test-admin"
        return TestClient(main.app)

    def _register(self, client, admin, engine_id="doctor-laptop-1"):
        reg = client.post(
            "/api/v1/engines/register",
            headers=admin,
            json={
                "engine_id": engine_id,
                "engine_type": "agent-doctor",
                "engine_version": "0.1.10",
                "owner_team": "it",
            },
        )
        self.assertEqual(reg.status_code, 200, reg.text)
        return reg.json()["ingest_token"]

    def test_doctor_ws_presence_and_fleet(self) -> None:
        client = self._client()
        admin = {"X-Admin-Token": os.environ.get("ADMIN_TOKEN", "test-admin")}
        token = self._register(client, admin)

        with client.websocket_connect(f"/api/v1/doctor/ws?token={token}") as ws:
            welcome = ws.receive_json()
            self.assertEqual(welcome["type"], "welcome")
            self.assertEqual(welcome["protocol_version"], 1)

            ws.send_json(
                {
                    "type": "hello",
                    "engine_id": "doctor-laptop-1",
                    "doctor_version": "0.1.10",
                    "node_id": "node-abc",
                    "inventory": {
                        "runtimes": [
                            {"id": "openclaw", "installed": True, "version": "1.2.0"},
                            {"id": "claude-code", "installed": True, "version": "2.0.0"},
                        ]
                    },
                }
            )
            ack = ws.receive_json()
            self.assertEqual(ack["type"], "ack")
            self.assertEqual(ack["of"], "hello")

            fleet = client.get("/api/v1/engines/fleet", headers=admin)
            match = next(e for e in fleet.json()["engines"] if e["engine_id"] == "doctor-laptop-1")
            self.assertTrue(match["online"])
            self.assertEqual(match["online_meta"].get("channel"), "doctor_ws")

        fleet_after = client.get("/api/v1/engines/fleet", headers=admin)
        match_after = next(
            e for e in fleet_after.json()["engines"] if e["engine_id"] == "doctor-laptop-1"
        )
        self.assertFalse(match_after["online"])

    def test_doctor_ws_job_assign_and_complete(self) -> None:
        client = self._client()
        admin = {"X-Admin-Token": os.environ.get("ADMIN_TOKEN", "test-admin")}
        token = self._register(client, admin, "doctor-exec-1")

        with client.websocket_connect(f"/api/v1/doctor/ws?token={token}") as ws:
            self.assertEqual(ws.receive_json()["type"], "welcome")
            ws.send_json(
                {
                    "type": "hello",
                    "engine_id": "doctor-exec-1",
                    "doctor_version": "0.1.10",
                    "inventory": {"runtimes": [{"id": "claude-code", "installed": True}]},
                }
            )
            self.assertEqual(ws.receive_json()["of"], "hello")

            create = client.post(
                "/api/v1/jobs",
                headers=admin,
                json={
                    "target_engine_id": "doctor-exec-1",
                    "title": "Echo",
                    "message": "Say hi",
                    "payload": {"runtime": "claude-code"},
                },
            )
            self.assertEqual(create.status_code, 200, create.text)
            job_id = create.json()["job"]["job_id"]

            assign = ws.receive_json()
            self.assertEqual(assign["type"], "job.assign")
            self.assertEqual(assign["job"]["job_id"], job_id)
            self.assertEqual(assign["job"]["message"], "Say hi")

            ws.send_json({"type": "job.ack", "job_id": job_id})
            ack = ws.receive_json()
            self.assertEqual(ack["of"], "job.ack")

            ws.send_json(
                {
                    "type": "job.complete",
                    "job_id": job_id,
                    "status": "succeeded",
                    "exit_code": 0,
                    "result_summary": "hi",
                    "log_excerpt": "hi from doctor",
                    "signals": {"runtime": "claude-code"},
                }
            )
            done = ws.receive_json()
            self.assertEqual(done["of"], "job.complete")

            jobs = client.get("/api/v1/jobs", headers=admin)
            match = next(j for j in jobs.json()["jobs"] if j["job_id"] == job_id)
            self.assertEqual(match["status"], "completed")
            self.assertIn("hi", match.get("result_summary") or "")

    def test_doctor_ws_rejects_bad_token(self) -> None:
        client = self._client()
        with self.assertRaises(Exception):
            with client.websocket_connect("/api/v1/doctor/ws?token=evi_bogus"):
                pass


if __name__ == "__main__":
    unittest.main()
