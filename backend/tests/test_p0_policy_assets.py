"""P0 policy, asset registry, and ingest enhancements tests."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from infra import asset_registry, policies, engine_ingest
from infra.redaction import redact_text


class RedactionTest(unittest.TestCase):
    def test_redacts_bearer_token(self) -> None:
        text = "Authorization: Bearer sk-abc123secret456789012345"
        self.assertIn("[REDACTED]", redact_text(text))
        self.assertNotIn("sk-abc123secret456789012345", redact_text(text))


class PoliciesStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(os.environ, {"EVOTOWN_DATA_DIR": self._tmpdir.name})
        self._env_patch.start()
        policies._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        policies._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_default_policies_seeded(self) -> None:
        payload = policies.list_policies()
        ids = {item["policy_id"] for item in payload["policies"]}
        self.assertIn("model-allowlist", ids)
        self.assertIn("tool-allowlist", ids)

    def test_upsert_policy(self) -> None:
        updated = policies.upsert_policy(
            {
                "policy_id": "model-allowlist",
                "category": "model",
                "name": "模型白名单",
                "description": "test",
                "enabled": False,
                "rules": {"allow_models": ["gpt-4o"]},
            }
        )
        self.assertFalse(updated["enabled"])
        self.assertEqual(updated["rules"]["allow_models"], ["gpt-4o"])


class AssetRegistryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(os.environ, {"EVOTOWN_DATA_DIR": self._tmpdir.name})
        self._env_patch.start()
        asset_registry._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        asset_registry._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_propose_and_review_asset(self) -> None:
        asset = asset_registry.propose_asset(
            {
                "asset_type": "prompt",
                "source_run_id": "run-001",
                "name": "CRM Summary Prompt",
                "description": "from run",
                "content": {"template": "summarize {{notes}}"},
            }
        )
        self.assertEqual(asset["status"], "pending")
        reviewed = asset_registry.review_asset(asset["asset_id"], decision="approved", reviewer="admin", reason="ok")
        assert reviewed is not None
        self.assertEqual(reviewed["status"], "approved")


class EngineIngestEnhancementsTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(os.environ, {"EVOTOWN_DATA_DIR": self._tmpdir.name})
        self._env_patch.start()
        engine_ingest._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        engine_ingest._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_cost_summary_includes_by_team(self) -> None:
        conn = engine_ingest._ensure_conn()  # noqa: SLF001
        conn.execute(
            """
            INSERT INTO external_runs (
                run_id, engine_id, engine_type, engine_version, team_id, status, exit_code, finished_at, signals
            ) VALUES ('r1', 'eng-a', 'custom', '1.0', 'sales', 'succeeded', 0, '2026-01-01', ?)
            """,
            ('{"cost_usd": 0.5, "input_tokens": 10, "output_tokens": 5}',),
        )
        summary = engine_ingest.cost_summary()
        team_ids = {item["team_id"] for item in summary.get("by_team", [])}
        self.assertIn("sales", team_ids)


class P0ApiTest(unittest.TestCase):
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
        policies._conn = None  # noqa: SLF001
        asset_registry._conn = None  # noqa: SLF001
        engine_ingest._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        policies._conn = None  # noqa: SLF001
        asset_registry._conn = None  # noqa: SLF001
        engine_ingest._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_policies_and_assets_api(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}

        pol = client.get("/api/v1/policies", headers=admin)
        self.assertEqual(pol.status_code, 200)
        self.assertGreaterEqual(len(pol.json()["policies"]), 3)

        asset = client.post(
            "/api/v1/assets/propose",
            headers=admin,
            json={
                "asset_type": "workflow",
                "source_run_id": "run-x",
                "name": "Onboarding Flow",
                "description": "demo",
            },
        )
        self.assertEqual(asset.status_code, 200)
        asset_id = asset.json()["asset"]["asset_id"]

        listed = client.get("/api/v1/assets?status_filter=pending", headers=admin)
        self.assertEqual(listed.status_code, 200)

        review = client.post(
            f"/api/v1/assets/{asset_id}/review",
            headers=admin,
            json={"decision": "approved", "reviewer": "admin"},
        )
        self.assertEqual(review.status_code, 200)
        self.assertEqual(review.json()["asset"]["status"], "approved")

        costs = client.get("/api/v1/costs/summary", headers=admin)
        self.assertEqual(costs.status_code, 200)
        self.assertIn("by_team", costs.json())

    def test_policies_readable_with_console_api_key(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)

        registered = client.post(
            "/api/v1/auth/register",
            json={"name": "Policy Reader", "owner_email": "reader@example.com"},
        )
        self.assertEqual(registered.status_code, 200)
        api_key = registered.json()["api_key"]

        pol = client.get("/api/v1/policies", headers={"Authorization": f"Bearer {api_key}"})
        self.assertEqual(pol.status_code, 200)
        self.assertGreaterEqual(len(pol.json()["policies"]), 3)
