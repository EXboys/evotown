import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from database_mcp_proxy.app import app


class ProxyAppTest(unittest.TestCase):
    def test_query_requires_auth(self) -> None:
        client = TestClient(app)
        resp = client.post("/query", json={"connection_id": "x", "sql": "SELECT 1"})
        self.assertEqual(resp.status_code, 401)

    @patch("database_mcp_proxy.app.EvotownClient")
    def test_query_happy_path(self, client_cls: MagicMock) -> None:
        mock = client_cls.return_value
        mock.assert_access = AsyncMock(return_value={"connection_id": "demo", "permission": "read"})
        mock.resolve_connection = AsyncMock(
            return_value={"db_type": "sqlite", "config": {"path": ":memory:"}}
        )

        import sqlite3
        import tempfile

        path = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE t (v INTEGER)")
        conn.execute("INSERT INTO t VALUES (42)")
        conn.commit()
        conn.close()

        async def resolve(_: str) -> dict:
            return {"db_type": "sqlite", "config": {"path": path}}

        mock.resolve_connection = AsyncMock(side_effect=resolve)

        client = TestClient(app)
        resp = client.post(
            "/query",
            json={"connection_id": "demo", "sql": "SELECT v FROM t"},
            headers={"Authorization": "Bearer evk_test"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["rows"][0]["v"], 42)


if __name__ == "__main__":
    unittest.main()
