"""Tests for public Skills Market catalog API."""
from __future__ import annotations

import os
import base64
import tempfile
import unittest
from unittest.mock import patch


class MarketApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin-token",
            },
            clear=False,
        )
        self._env_patch.start()
        self._dotenv_patch = patch("dotenv.load_dotenv")
        self._dotenv_patch.start()
        from infra import skill_market

        skill_market._conn = None  # noqa: SLF001
        from infra import accounts as accounts_store

        accounts_store._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import skill_market
        from infra import accounts as accounts_store

        skill_market._conn = None  # noqa: SLF001
        accounts_store._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_market_lists_approved_skills_and_tracks_downloads(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}
        package_bytes = b"# SKILL\nmarket package\n"

        upload = client.post(
            "/api/v1/skill-packages",
            json={
                "skill_id": "market-demo",
                "name": "Market Demo",
                "description": "Catalog demo skill.",
                "version": "1.0.0",
                "runtime_targets": ["openclaw", "hermes"],
                "visibility": "company",
                "tags": ["demo", "market"],
                "readme": "# Market Demo\nInstall me from /market.",
                "dependencies": ["http-request"],
                "filename": "market-demo.zip",
                "content_base64": base64.b64encode(package_bytes).decode("ascii"),
            },
            headers=admin,
        )
        self.assertEqual(upload.status_code, 200)

        catalog = client.get("/api/v1/market/skills?query=market")
        self.assertEqual(catalog.status_code, 200)
        ids = [item["skill_id"] for item in catalog.json()["skills"]]
        self.assertIn("market-demo", ids)

        detail = client.get("/api/v1/market/skills/market-demo")
        self.assertEqual(detail.status_code, 200)
        skill = detail.json()["skill"]
        self.assertEqual(skill["readme"], "# Market Demo\nInstall me from /market.")
        self.assertGreaterEqual(len(skill["versions"]), 1)

        register = client.post(
            "/api/v1/auth/register",
            json={"name": "Market User", "owner_email": "user@example.com"},
        )
        api_key = register.json()["api_key"]

        downloaded = client.get(
            "/api/v1/market/skills/market-demo/download",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(downloaded.content, package_bytes)

        detail_after = client.get("/api/v1/market/skills/market-demo")
        self.assertEqual(detail_after.json()["skill"]["download_count"], 1)

    def test_market_manifest_requires_employee_key(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)

        unauth = client.get(
            "/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=hermes",
        )
        self.assertEqual(unauth.status_code, 401)

        admin = {"X-Admin-Token": "test-admin-token"}
        account = client.post(
            "/api/v1/accounts",
            json={"name": "Manifest User", "team_id": "default", "owner_email": "manifest@example.com"},
            headers=admin,
        )
        self.assertEqual(account.status_code, 200)
        account_id = account.json()["account"]["account_id"]
        key_resp = client.post(
            f"/api/v1/accounts/{account_id}/keys",
            json={"label": "employee", "scopes": ["gateway.chat", "console.read"]},
            headers=admin,
        )
        self.assertEqual(key_resp.status_code, 200)
        api_key = key_resp.json()["secret"]

        manifest = client.get(
            "/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=hermes",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        self.assertEqual(manifest.status_code, 200)
        body = manifest.json()["manifest"]
        self.assertEqual(body["bundle_id"], "default-agent-skills")
        self.assertGreaterEqual(len(body["skills"]), 1)
        for entry in body["skills"]:
            if entry.get("skill_id") == "http-request":
                self.assertTrue(
                    str(entry.get("package_url", "")).endswith("/api/v1/market/skills/http-request/download"),
                )
                break
        else:
            self.fail("expected seeded http-request in manifest")

    def test_market_downloads_builtin_seed_skill(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main
        import zipfile
        import io

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}
        account = client.post(
            "/api/v1/accounts",
            json={"name": "Builtin User", "team_id": "default", "owner_email": "builtin@example.com"},
            headers=admin,
        )
        account_id = account.json()["account"]["account_id"]
        key_resp = client.post(
            f"/api/v1/accounts/{account_id}/keys",
            json={"label": "employee", "scopes": ["gateway.chat", "console.read"]},
            headers=admin,
        )
        api_key = key_resp.json()["secret"]

        downloaded = client.get(
            "/api/v1/market/skills/http-request/download",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        self.assertEqual(downloaded.status_code, 200, downloaded.text)
        self.assertTrue(downloaded.content.startswith(b"PK"), "expected zip archive")
        with zipfile.ZipFile(io.BytesIO(downloaded.content)) as zf:
            names = zf.namelist()
        self.assertIn("SKILL.md", names)


if __name__ == "__main__":
    unittest.main()
