"""Tests for enterprise knowledge connector API."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch


class KnowledgeApiTest(unittest.TestCase):
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
        from infra import knowledge

        knowledge._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import knowledge

        knowledge._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_demo_sources_sync_and_search(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}

        sources = client.get("/api/v1/knowledge/sources/manage", headers=admin)
        self.assertEqual(sources.status_code, 200)
        self.assertGreaterEqual(len(sources.json()["sources"]), 2)

        sync = client.post("/api/v1/knowledge/sources/feishu-demo/sync", headers=admin)
        self.assertEqual(sync.status_code, 200)
        self.assertEqual(sync.json()["sync"]["status"], "succeeded")
        self.assertGreater(sync.json()["sync"]["document_count"], 0)

        search = client.get("/api/v1/knowledge/search?q=Agent")
        self.assertEqual(search.status_code, 200)
        self.assertGreaterEqual(len(search.json()["results"]), 1)

        stats = client.get("/api/v1/knowledge/stats")
        self.assertEqual(stats.status_code, 200)
        self.assertGreaterEqual(stats.json()["indexed_documents"], 1)

    def test_create_source_and_connector_ingest(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}
        ingest = {"Authorization": "Bearer test-ingest-token"}

        created = client.post(
            "/api/v1/knowledge/sources",
            json={
                "source_id": "custom-crm",
                "source_type": "custom",
                "name": "CRM Docs",
                "team_id": "sales",
                "config": {"demo": True},
            },
            headers=admin,
        )
        self.assertEqual(created.status_code, 200)

        pushed = client.post(
            "/api/v1/knowledge/documents/ingest",
            json={
                "source_id": "custom-crm",
                "documents": [
                    {
                        "external_id": "crm-pricing",
                        "title": "CRM 定价策略",
                        "url": "https://example.com/crm/pricing",
                        "content_text": "Enterprise CRM pricing tiers and discount policy for sales agents.",
                        "tags": ["crm", "pricing"],
                        "team_id": "sales",
                    }
                ],
            },
            headers=ingest,
        )
        self.assertEqual(pushed.status_code, 200)
        self.assertEqual(pushed.json()["added"], 1)

        search = client.get("/api/v1/knowledge/search?q=pricing&team_id=sales")
        self.assertEqual(search.status_code, 200)
        titles = [item["title"] for item in search.json()["results"]]
        self.assertIn("CRM 定价策略", titles)


if __name__ == "__main__":
    unittest.main()
