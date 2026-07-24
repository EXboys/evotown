"""Task pool API auth and rate-limit tests."""
from __future__ import annotations

import importlib
import os
import tempfile
import unittest
from unittest.mock import patch


class TaskPoolAuthTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin-token",
                "EVOTOWN_TASK_CREATE_RPM": "3",
            },
            clear=False,
        )
        self._env_patch.start()
        self._dotenv_patch = patch("dotenv.load_dotenv")
        self._dotenv_patch.start()
        from infra import task_pool

        task_pool._CREATE_RATE_BUCKETS.clear()  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import task_pool

        task_pool._CREATE_RATE_BUCKETS.clear()  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _client(self):
        import main

        importlib.reload(main)
        from fastapi.testclient import TestClient

        return TestClient(main.app)

    def test_create_requires_authentication(self) -> None:
        client = self._client()
        resp = client.post(
            "/api/v1/tasks",
            json={"title": "Anonymous task", "description": "should fail"},
        )
        self.assertEqual(resp.status_code, 401)

    def test_admin_can_create_task(self) -> None:
        client = self._client()
        resp = client.post(
            "/api/v1/tasks",
            headers={"X-Admin-Token": "test-admin-token"},
            json={
                "title": "Admin task",
                "description": "from admin panel",
                "source": "admin",
            },
        )
        self.assertEqual(resp.status_code, 200)
        task = resp.json()["task"]
        self.assertEqual(task["title"], "Admin task")
        self.assertEqual(task["source"], "admin")

    def test_api_key_submitter_is_server_derived(self) -> None:
        client = self._client()
        from infra import accounts as accounts_store

        admin = {"X-Admin-Token": "test-admin-token"}
        account = client.post(
            "/api/v1/accounts",
            json={"name": "Task Submitter", "owner_email": "task@example.com", "org_id": "org_root"},
            headers=admin,
        )
        self.assertEqual(account.status_code, 200)
        account_id = account.json()["account"]["account_id"]
        key_resp = client.post(
            f"/api/v1/accounts/{account_id}/keys",
            json={"label": "submitter", "scopes": list(accounts_store.DEFAULT_CONSOLE_KEY_SCOPES)},
            headers=admin,
        )
        self.assertEqual(key_resp.status_code, 200)
        api_key = key_resp.json()["secret"]

        resp = client.post(
            "/api/v1/tasks",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "title": "Employee task",
                "description": "via api key",
                "submitter_type": "admin",
                "submitter_id": "spoofed-id",
            },
        )
        self.assertEqual(resp.status_code, 200)
        task = resp.json()["task"]
        self.assertEqual(task["submitter_type"], "api_key")
        self.assertEqual(task["submitter_id"], account_id)
        self.assertEqual(task["source"], "portal")

    def test_api_key_without_task_submit_scope_forbidden(self) -> None:
        client = self._client()
        account = client.post(
            "/api/v1/accounts",
            json={"name": "Limited", "org_id": "org_root"},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        self.assertEqual(account.status_code, 200)
        account_id = account.json()["account"]["account_id"]

        limited = client.post(
            f"/api/v1/accounts/{account_id}/keys",
            json={"label": "gateway-only", "scopes": ["gateway.chat", "console.read"]},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        self.assertEqual(limited.status_code, 200)
        secret = limited.json()["secret"]

        resp = client.post(
            "/api/v1/tasks",
            headers={"Authorization": f"Bearer {secret}"},
            json={"title": "Blocked", "description": "no task.submit"},
        )
        self.assertEqual(resp.status_code, 401)

    def test_api_key_with_task_submit_only_allowed(self) -> None:
        client = self._client()
        account = client.post(
            "/api/v1/accounts",
            json={"name": "Task Bot", "org_id": "org_root"},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        account_id = account.json()["account"]["account_id"]

        key_resp = client.post(
            f"/api/v1/accounts/{account_id}/keys",
            json={"label": "task-bot", "scopes": ["task.submit"]},
            headers={"X-Admin-Token": "test-admin-token"},
        )
        secret = key_resp.json()["secret"]

        resp = client.post(
            "/api/v1/tasks",
            headers={"Authorization": f"Bearer {secret}"},
            json={"title": "Bot task", "description": "scoped key"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["task"]["submitter_type"], "api_key")

    def test_staff_employee_can_create_task(self) -> None:
        client = self._client()
        from infra import accounts as accounts_store

        acct = accounts_store.create_account(
            name="Staff Employee",
            login_name="emp1",
            password="secret",
            role="employee",
        )
        login = client.post(
            "/api/v1/auth/staff-login",
            json={"login_name": "emp1", "password": "secret"},
        )
        self.assertEqual(login.status_code, 200)
        token = login.json()["session_token"]

        resp = client.post(
            "/api/v1/tasks",
            headers={"Authorization": f"Bearer {token}"},
            json={"title": "Staff task", "description": "from employee"},
        )
        self.assertEqual(resp.status_code, 200)
        task = resp.json()["task"]
        self.assertEqual(task["submitter_type"], "employee")
        self.assertEqual(task["submitter_id"], acct["account_id"])

    def test_create_rate_limit(self) -> None:
        client = self._client()
        headers = {"X-Admin-Token": "test-admin-token"}
        payload = {"title": "Rate limited", "description": "x", "source": "admin"}

        for _ in range(3):
            resp = client.post("/api/v1/tasks", headers=headers, json=payload)
            self.assertEqual(resp.status_code, 200)

        blocked = client.post("/api/v1/tasks", headers=headers, json=payload)
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.json()["detail"], "task_create_rate_limit_exceeded")


if __name__ == "__main__":
    unittest.main()
