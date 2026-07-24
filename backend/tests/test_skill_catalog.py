"""Tests for skill catalog discovery and import."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from infra import skill_catalog, skill_market


class SkillCatalogTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(os.environ, {"EVOTOWN_DATA_DIR": self._tmpdir.name})
        self._env_patch.start()
        skill_market._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        skill_market._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_starter_catalog_lists_all_arena_skills(self) -> None:
        entries = skill_catalog.list_starter_entries()
        ids = {item["skill_id"] for item in entries}
        self.assertIn("http-request", ids)
        self.assertIn("agent-browser", ids)
        self.assertIn("skill-creator", ids)
        self.assertEqual(len(entries), 5)

    def test_import_starter_registers_approved_skill(self) -> None:
        skill = skill_catalog.import_starter_skill("agent-browser")
        self.assertEqual(skill["skill_id"], "agent-browser")
        self.assertEqual(skill["status"], "approved")
        self.assertTrue(str(skill["package_url"]).startswith("builtin://"))

    def test_ecosystem_import_creates_pending_candidate(self) -> None:
        candidate = skill_catalog.import_ecosystem_skill("vercel-react-best-practices")
        self.assertEqual(candidate["status"], "pending")
        self.assertEqual(candidate["engine_id"], "evotown-catalog")
        inline = candidate.get("inline_manifest") or {}
        self.assertEqual(inline.get("import_origin"), "ecosystem")

    def test_parse_skills_sh_url_and_fuzzy_dir_match(self) -> None:
        parsed = skill_market._parse_remote_skill_ref(  # noqa: SLF001
            {"package_url": "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices"}
        )
        self.assertEqual(parsed, ("vercel-labs", "agent-skills", "vercel-react-best-practices"))
        self.assertIn("react-best-practices", skill_market._candidate_skill_dir_names("vercel-react-best-practices"))  # noqa: SLF001

    def test_default_bundle_includes_all_starters_on_fresh_db(self) -> None:
        manifest = skill_market.get_bundle_manifest("default-agent-skills")
        self.assertIsNotNone(manifest)
        assert manifest is not None
        skill_ids = {item["skill_id"] for item in manifest["skills"]}
        self.assertIn("agent-browser", skill_ids)
        self.assertIn("skill-creator", skill_ids)


class SkillCatalogApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {"EVOTOWN_DATA_DIR": self._tmpdir.name, "ADMIN_TOKEN": "test-admin-token"},
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

    def test_catalog_api_endpoints(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}

        starter = client.get("/api/v1/skill-catalog/starter", headers=admin)
        self.assertEqual(starter.status_code, 200)
        self.assertGreaterEqual(len(starter.json()["skills"]), 5)

        imported = client.post(
            "/api/v1/skill-catalog/starter/import",
            headers=admin,
            json={"catalog_id": "calculator", "auto_approve": True},
        )
        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.json()["skill"]["skill_id"], "calculator")

        ecosystem = client.get("/api/v1/skill-catalog/ecosystem?limit=5", headers=admin)
        self.assertEqual(ecosystem.status_code, 200)
        self.assertGreaterEqual(len(ecosystem.json()["skills"]), 1)

        sync = client.post("/api/v1/skill-catalog/ecosystem/sync", headers=admin)
        self.assertEqual(sync.status_code, 200)
        self.assertTrue(sync.json()["synced"])

        eco_import = client.post(
            "/api/v1/skill-catalog/ecosystem/import",
            headers=admin,
            json={"catalog_id": "web-design-guidelines", "runtime_target": "skilllite"},
        )
        self.assertEqual(eco_import.status_code, 200)
        self.assertEqual(eco_import.json()["candidate"]["status"], "pending")
