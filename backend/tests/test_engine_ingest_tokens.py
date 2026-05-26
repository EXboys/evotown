"""Per-engine ingest tokens (evi_)."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch


class EngineIngestTokenTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin",
                "EVOTOWN_ENGINE_INGEST_TOKEN": "test-ingest-bootstrap",
            },
            clear=False,
        )
        self._env_patch.start()
        from pathlib import Path
        from infra import engine_ingest

        engine_ingest._conn = None
        engine_ingest._DATA_DIR = Path(self._tmpdir.name)
        engine_ingest._DB_PATH = Path(self._tmpdir.name) / "engine_ingest.db"

    def tearDown(self) -> None:
        from infra import engine_ingest

        engine_ingest._conn = None
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        return TestClient(main.app)

    def _register_with_token(self, client, engine_id: str) -> str:
        bootstrap = {"Authorization": "Bearer test-ingest-bootstrap"}
        res = client.post(
            "/api/v1/engines/register",
            headers=bootstrap,
            json={
                "engine_id": engine_id,
                "engine_type": "openclaw",
                "engine_version": "1.0.0",
                "owner_team": "sales",
            },
        )
        self.assertEqual(res.status_code, 200)
        token = res.json().get("ingest_token")
        self.assertTrue(token and token.startswith("evi_"))
        return token

    def test_scoped_token_cannot_impersonate_other_engine(self) -> None:
        client = self._client()
        alice_token = self._register_with_token(client, "openclaw-alice")
        self._register_with_token(client, "openclaw-bob")

        handoff = client.post(
            "/api/v1/jobs/from-engine",
            headers={"Authorization": f"Bearer {alice_token}"},
            json={
                "kind": "handoff",
                "source_engine_id": "openclaw-bob",
                "target_team_id": "finance",
                "message": "forged",
            },
        )
        self.assertEqual(handoff.status_code, 403)

    def test_scoped_token_handoff_as_self(self) -> None:
        client = self._client()
        alice_token = self._register_with_token(client, "openclaw-alice")
        client.post(
            "/api/v1/engines/register",
            headers={"Authorization": "Bearer test-ingest-bootstrap"},
            json={
                "engine_id": "openclaw-finance",
                "engine_type": "hermes",
                "engine_version": "1.0.0",
                "owner_team": "finance",
            },
        )

        ok = client.post(
            "/api/v1/jobs/from-engine",
            headers={"Authorization": f"Bearer {alice_token}"},
            json={
                "kind": "handoff",
                "source_engine_id": "openclaw-alice",
                "target_team_id": "finance",
                "message": "legit",
            },
        )
        self.assertEqual(ok.status_code, 200)

    def test_per_engine_token_cannot_register(self) -> None:
        client = self._client()
        token = self._register_with_token(client, "eng-a")
        res = client.post(
            "/api/v1/engines/register",
            headers={"Authorization": f"Bearer {token}"},
            json={"engine_id": "eng-b", "engine_type": "openclaw", "engine_version": "1"},
        )
        self.assertEqual(res.status_code, 403)

    def test_engine_can_poll_own_run_status(self) -> None:
        client = self._client()
        token = self._register_with_token(client, "eng-poll")
        headers = {"Authorization": f"Bearer {token}"}
        started = {
            "event_type": "run.started",
            "run_id": "run-poll-1",
            "engine_id": "eng-poll",
            "engine_type": "openclaw",
            "engine_version": "1.0.0",
            "status": "running",
            "ts": "2026-05-26T10:00:00Z",
        }
        self.assertEqual(client.post("/api/v1/events", headers=headers, json=started).status_code, 200)
        st = client.get("/api/v1/runs/run-poll-1/status?engine_id=eng-poll", headers=headers)
        self.assertEqual(st.status_code, 200)
        self.assertEqual(st.json()["status"], "running")

        done = {
            **started,
            "event_type": "run.completed",
            "status": "succeeded",
            "exit_code": 0,
            "ts": "2026-05-26T10:01:00Z",
            "seq": 1,
        }
        self.assertEqual(client.post("/api/v1/events", headers=headers, json=done).status_code, 200)
        st2 = client.get("/api/v1/runs/run-poll-1/status?engine_id=eng-poll", headers=headers)
        self.assertEqual(st2.json()["status"], "succeeded")

        other = client.get("/api/v1/runs/run-poll-1/status?engine_id=other-engine", headers=headers)
        self.assertEqual(other.status_code, 403)

    def test_admin_rotate_token(self) -> None:
        client = self._client()
        bootstrap = {"Authorization": "Bearer test-ingest-bootstrap"}
        client.post(
            "/api/v1/engines/register",
            headers=bootstrap,
            json={"engine_id": "rotate-me", "engine_type": "openclaw", "engine_version": "1"},
        )
        rot = client.post(
            "/api/v1/engines/rotate-me/rotate-ingest-token",
            headers={"X-Admin-Token": "test-admin"},
        )
        self.assertEqual(rot.status_code, 200)
        self.assertTrue(rot.json()["ingest_token"].startswith("evi_"))


if __name__ == "__main__":
    unittest.main()
