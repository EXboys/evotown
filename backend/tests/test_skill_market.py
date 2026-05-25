"""Smoke tests for private Skills Market MVP."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from infra import skill_market


class SkillMarketStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(os.environ, {"EVOTOWN_DATA_DIR": self._tmpdir.name})
        self._env_patch.start()
        skill_market._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        skill_market._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_default_bundle_manifest_is_seeded(self) -> None:
        manifest = skill_market.get_bundle_manifest("default-agent-skills", runtime_target="skilllite")
        self.assertIsNotNone(manifest)
        assert manifest is not None
        self.assertEqual(manifest["bundle_id"], "default-agent-skills")
        self.assertGreaterEqual(len(manifest["skills"]), 1)


class SkillMarketApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin-token",
                "EVOTOWN_ENGINE_INGEST_TOKEN": "test-ingest-token",
            },
            clear=False,
        )
        self._env_patch.start()
        self._dotenv_patch = patch("dotenv.load_dotenv")
        self._dotenv_patch.start()
        skill_market._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        skill_market._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_connector_candidate_review_promotes_skill(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}
        ingest = {"Authorization": "Bearer test-ingest-token"}

        bundle = client.get(
            "/api/v1/skill-bundles/default-agent-skills/manifest?runtime_target=hermes",
            headers=admin,
        )
        self.assertEqual(bundle.status_code, 200)
        self.assertEqual(bundle.json()["manifest"]["bundle_id"], "default-agent-skills")

        candidate_body = {
            "candidate_id": "cand_001",
            "source_run_id": "run-001",
            "tenant_id": "company-a",
            "team_id": "growth-team",
            "agent_id": "agent-001",
            "engine_id": "hermes-local",
            "runtime_target": "hermes",
            "name": "Summarize CRM Notes",
            "description": "Extract action items from CRM notes.",
            "inline_manifest": {"entrypoint": "SKILL.md"},
            "signals": {"task_completed": True},
        }
        created = client.post("/api/v1/skill-candidates", json=candidate_body, headers=ingest)
        self.assertEqual(created.status_code, 200)
        self.assertTrue(created.json()["created"])
        self.assertEqual(created.json()["candidate"]["status"], "pending")

        review = client.post(
            "/api/v1/skill-candidates/cand_001/review",
            json={
                "decision": "approved",
                "reviewer": "platform-owner",
                "reason": "validated in staging",
                "visibility": "team",
                "promotion_channel": "stable",
            },
            headers=admin,
        )
        self.assertEqual(review.status_code, 200)
        self.assertEqual(review.json()["candidate"]["status"], "approved")

        skills = client.get("/api/v1/skills?runtime_target=hermes&query=crm", headers=admin)
        self.assertEqual(skills.status_code, 200)
        names = [item["name"] for item in skills.json()["skills"]]
        self.assertIn("Summarize CRM Notes", names)

    def test_candidate_submission_requires_ingest_token(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        res = client.post(
            "/api/v1/skill-candidates",
            json={
                "candidate_id": "cand_forbidden",
                "source_run_id": "run-001",
                "engine_id": "hermes-local",
                "runtime_target": "hermes",
                "name": "Forbidden",
            },
            headers={"X-Admin-Token": "test-admin-token"},
        )
        self.assertEqual(res.status_code, 403)


if __name__ == "__main__":
    unittest.main()

