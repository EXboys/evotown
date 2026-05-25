"""Console auth registration and API-key session tests."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch


class ConsoleAuthApiTest(unittest.TestCase):
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
        from infra import accounts as accounts_store

        accounts_store._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import accounts as accounts_store

        accounts_store._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_register_login_and_access_skills_with_console_key(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)

        registered = client.post(
            "/api/v1/auth/register",
            json={"name": "Platform Owner", "owner_email": "owner@example.com", "team_id": "platform"},
        )
        self.assertEqual(registered.status_code, 200)
        api_key = registered.json()["api_key"]
        self.assertTrue(api_key.startswith("evk_"))

        login = client.post("/api/v1/auth/login", json={"api_key": api_key})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["session"]["account_name"], "Platform Owner")

        me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {api_key}"})
        self.assertEqual(me.status_code, 200)

        skills = client.get("/api/v1/skills?limit=1", headers={"Authorization": f"Bearer {api_key}"})
        self.assertEqual(skills.status_code, 200)

        gateway_only_account = client.post(
            "/api/v1/accounts",
            json={"name": "Gateway Only", "team_id": "ops"},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        self.assertEqual(gateway_only_account.status_code, 200)
        account_id = gateway_only_account.json()["account"]["account_id"]

        limited_key = client.post(
            f"/api/v1/accounts/{account_id}/keys",
            json={"label": "limited", "scopes": ["gateway.chat"]},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        self.assertEqual(limited_key.status_code, 200)
        limited_secret = limited_key.json()["secret"]

        blocked = client.get("/api/v1/skills?limit=1", headers={"Authorization": f"Bearer {limited_secret}"})
        self.assertEqual(blocked.status_code, 403)


if __name__ == "__main__":
    unittest.main()
