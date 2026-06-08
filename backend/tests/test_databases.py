"""Tests for enterprise database connector registry."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch


class DatabaseRegistryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin-token",
                "EVOTOWN_DATABASE_MCP_TOKEN": "test-mcp-token",
            },
            clear=False,
        )
        self._env_patch.start()
        self._dotenv_patch = patch("dotenv.load_dotenv")
        self._dotenv_patch.start()
        from infra import database_registry

        database_registry._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import database_registry

        database_registry._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_create_connection_grant_and_mcp_resolve(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}
        mcp = {"Authorization": "Bearer test-mcp-token"}

        created = client.post(
            "/api/v1/databases",
            json={
                "connection_id": "crm-demo",
                "name": "CRM Demo",
                "db_type": "postgres",
                "team_id": "sales",
                "mcp_server_url": "http://localhost:9100/crm-demo",
                "description": "demo",
                "config": {
                    "host": "127.0.0.1",
                    "port": 5432,
                    "database": "crm",
                    "username": "readonly",
                    "password": "secret-pass",
                },
            },
            headers=admin,
        )
        self.assertEqual(created.status_code, 200)
        self.assertTrue(created.json()["connection"]["config"]["password_set"])
        self.assertNotIn("password", created.json()["connection"]["config"])

        grant = client.post(
            "/api/v1/databases/grants",
            json={
                "connection_id": "crm-demo",
                "principal_type": "org",
                "principal_id": "org_sales",
                "permission": "read",
            },
            headers=admin,
        )
        self.assertEqual(grant.status_code, 200)

        resolve = client.get("/api/v1/databases/mcp/crm-demo/resolve", headers=mcp)
        self.assertEqual(resolve.status_code, 200)
        self.assertEqual(resolve.json()["connection"]["config"]["password"], "secret-pass")

        stats = client.get("/api/v1/databases/stats", headers=admin)
        self.assertEqual(stats.status_code, 200)
        self.assertEqual(stats.json()["active_connections"], 1)

    def test_connection_test_sqlite(self) -> None:
        import sqlite3
        from fastapi.testclient import TestClient
        import importlib
        import main

        db_path = f"{self._tmpdir.name}/test.db"
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE ping (v INTEGER)")
        conn.close()

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}

        created = client.post(
            "/api/v1/databases",
            json={
                "connection_id": "sqlite-local",
                "name": "Local SQLite",
                "db_type": "sqlite",
                "config": {"path": db_path},
            },
            headers=admin,
        )
        self.assertEqual(created.status_code, 200)

        test = client.post("/api/v1/databases/sqlite-local/test", headers=admin)
        self.assertEqual(test.status_code, 200)
        self.assertTrue(test.json()["ok"])
        self.assertTrue(test.json()["database"]["ok"])

        draft = client.post(
            "/api/v1/databases/test-config",
            json={"db_type": "sqlite", "config": {"path": db_path}},
            headers=admin,
        )
        self.assertEqual(draft.status_code, 200)
        self.assertTrue(draft.json()["database"]["ok"])

    def test_mcp_resolve_rejects_anonymous(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        resp = client.get("/api/v1/databases/mcp/crm-demo/resolve")
        self.assertEqual(resp.status_code, 403)


if __name__ == "__main__":
    unittest.main()
