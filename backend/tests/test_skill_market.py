"""Smoke tests for private Skills Market MVP."""
from __future__ import annotations

import os
import base64
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

    def test_admin_uploads_private_skill_package(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}
        package_bytes = b"# SKILL\nprivate package\n"
        res = client.post(
            "/api/v1/skill-packages",
            json={
                "skill_id": "private-crm-summary",
                "name": "Private CRM Summary",
                "description": "Internal package for CRM notes.",
                "version": "1.0.0",
                "runtime_targets": ["openclaw", "hermes", "skilllite"],
                "visibility": "team",
                "team_id": "growth-team",
                "tags": ["crm", "private"],
                "filename": "private-crm-summary.skill.zip",
                "content_base64": base64.b64encode(package_bytes).decode("ascii"),
            },
            headers=admin,
        )
        self.assertEqual(res.status_code, 200)
        skill = res.json()["skill"]
        self.assertEqual(skill["skill_id"], "private-crm-summary")
        self.assertEqual(skill["package_bytes"], len(package_bytes))
        self.assertTrue(skill["package_url"].endswith("/api/v1/skill-packages/private-crm-summary/download"))

        listed = client.get("/api/v1/skills?runtime_target=hermes&tag=crm", headers=admin)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["skills"][0]["skill_id"], "private-crm-summary")

        downloaded = client.get("/api/v1/skill-packages/private-crm-summary/download", headers=admin)
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(downloaded.content, package_bytes)

    def test_admin_deprecates_skill_and_manifest_filters_it(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}

        before = client.get(
            "/api/v1/skill-bundles/default-agent-skills/manifest?runtime_target=hermes",
            headers=admin,
        )
        self.assertEqual(before.status_code, 200)
        self.assertIn("http-request", {item["skill_id"] for item in before.json()["manifest"]["skills"]})

        deprecate = client.post(
            "/api/v1/skills/http-request/deprecate",
            json={"reason": "retired", "reviewer": "platform-owner"},
            headers=admin,
        )
        self.assertEqual(deprecate.status_code, 200)
        self.assertEqual(deprecate.json()["skill"]["status"], "deprecated")

        after = client.get(
            "/api/v1/skill-bundles/default-agent-skills/manifest?runtime_target=hermes",
            headers=admin,
        )
        self.assertEqual(after.status_code, 200)
        self.assertNotIn("http-request", {item["skill_id"] for item in after.json()["manifest"]["skills"]})

        filtered = client.get("/api/v1/skills?status_filter=deprecated&query=http", headers=admin)
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.json()["skills"][0]["skill_id"], "http-request")

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

