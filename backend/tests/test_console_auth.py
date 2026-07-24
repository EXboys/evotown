"""Console auth and API-key scope tests (staff-only login model)."""
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

    def test_console_key_can_access_skills_and_limited_key_cannot(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main
        from infra import accounts as accounts_store

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}

        account = client.post(
            "/api/v1/accounts",
            json={"name": "Platform Owner", "owner_email": "owner@example.com", "org_id": "org_root"},
            headers=admin,
        )
        self.assertEqual(account.status_code, 200)
        account_id = account.json()["account"]["account_id"]

        key_resp = client.post(
            f"/api/v1/accounts/{account_id}/keys",
            json={"label": "console", "scopes": list(accounts_store.DEFAULT_CONSOLE_KEY_SCOPES)},
            headers=admin,
        )
        self.assertEqual(key_resp.status_code, 200)
        api_key = key_resp.json()["secret"]
        self.assertTrue(api_key.startswith("evk_"))

        skills = client.get("/api/v1/skills?limit=1", headers={"Authorization": f"Bearer {api_key}"})
        self.assertEqual(skills.status_code, 200)

        gateway_only_account = client.post(
            "/api/v1/accounts",
            json={"name": "Gateway Only", "org_id": "org_root"},
            headers=admin,
        )
        self.assertEqual(gateway_only_account.status_code, 200)
        limited_account_id = gateway_only_account.json()["account"]["account_id"]

        limited_key = client.post(
            f"/api/v1/accounts/{limited_account_id}/keys",
            json={"label": "limited", "scopes": ["gateway.chat"]},
            headers=admin,
        )
        self.assertEqual(limited_key.status_code, 200)
        limited_secret = limited_key.json()["secret"]

        blocked = client.get("/api/v1/skills?limit=1", headers={"Authorization": f"Bearer {limited_secret}"})
        self.assertEqual(blocked.status_code, 403)

    def test_read_only_console_key_can_read_but_not_admin_routes(self) -> None:
        """Deploy-style keys with console.read only must pass read APIs but fail admin APIs with 403."""
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}

        account = client.post(
            "/api/v1/accounts",
            json={"name": "Read Only", "org_id": "org_root"},
            headers=admin,
        )
        self.assertEqual(account.status_code, 200)
        account_id = account.json()["account"]["account_id"]

        key_resp = client.post(
            f"/api/v1/accounts/{account_id}/keys",
            json={"label": "deploy-style", "scopes": ["gateway.chat", "console.read"]},
            headers=admin,
        )
        self.assertEqual(key_resp.status_code, 200)
        secret = key_resp.json()["secret"]

        policies = client.get("/api/v1/policies", headers={"Authorization": f"Bearer {secret}"})
        self.assertEqual(policies.status_code, 200)

        fleet = client.get("/api/v1/engines/fleet", headers={"Authorization": f"Bearer {secret}"})
        self.assertEqual(fleet.status_code, 403)

    def test_staff_employee_no_agent_write_cannot_create_agent(self) -> None:
        """Employee scopes no longer include agent.write — creation requires admin console.write."""
        import time

        from fastapi.testclient import TestClient
        import importlib
        import main
        from infra import accounts as accounts_store

        importlib.reload(main)
        client = TestClient(main.app)

        account = accounts_store.create_account(
            name="Employee A",
            org_id="org_test",
            login_name="employee_a",
            password="secret-pass",
            role="employee",
        )
        login = client.post(
            "/api/v1/auth/staff-login",
            json={"login_name": "employee_a", "password": "secret-pass"},
        )
        self.assertEqual(login.status_code, 200)
        token = login.json()["session_token"]

        me = client.get("/api/v1/auth/staff-me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me.status_code, 200)
        scopes = me.json()["account"]["scopes"]
        self.assertNotIn("agent.write", scopes)

        create = client.post(
            "/api/v1/agents",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "My Sandbox"},
        )
        self.assertEqual(create.status_code, 403, create.text)


if __name__ == "__main__":
    unittest.main()
