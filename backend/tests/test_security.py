"""Security hardening: ingest read auth, token role split, legacy gateway metering."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from core.auth import legacy_key_id, _resolve_gateway_identity
from infra import accounts as accounts_store
from infra import gateway as gateway_store


class IngestReadAuthTest(unittest.TestCase):
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
        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        from infra import engine_ingest as engine_store
        from pathlib import Path
        engine_store._conn = None  # noqa: SLF001
        engine_store._DATA_DIR = Path(self._tmpdir.name)  # noqa: SLF001
        engine_store._DB_PATH = Path(self._tmpdir.name) / "engine_ingest.db"  # noqa: SLF001

    def tearDown(self) -> None:
        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        from infra import engine_ingest as engine_store
        engine_store._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_ingest_reads_require_admin(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)

        for path in (
            "/api/v1/engines",
            "/api/v1/runs",
            "/api/v1/policy/violations",
            "/api/v1/costs/summary",
        ):
            self.assertEqual(client.get(path).status_code, 403, path)

        admin = {"X-Admin-Token": "test-admin-token"}
        self.assertEqual(client.get("/api/v1/engines", headers=admin).status_code, 200)
        self.assertEqual(client.get("/api/v1/runs", headers=admin).status_code, 200)

    def test_ingest_write_requires_ingest_token_not_admin_header(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}
        bootstrap = {"Authorization": "Bearer test-ingest-token"}

        res = client.post(
            "/api/v1/engines/register",
            json={
                "engine_id": "eng_test",
                "engine_type": "custom",
                "engine_version": "1.0",
            },
            headers=admin,
        )
        self.assertEqual(res.status_code, 200)
        evi = res.json().get("ingest_token")
        self.assertTrue(evi and evi.startswith("evi_"))

        event = {
            "event_type": "run.started",
            "run_id": "run-admin-deny",
            "engine_id": "eng_test",
            "engine_type": "custom",
            "engine_version": "1.0",
            "status": "running",
            "ts": "2026-05-25T09:00:00Z",
        }
        res = client.post("/api/v1/events", json=event, headers=admin)
        self.assertEqual(res.status_code, 403)

        res = client.post(
            "/api/v1/events",
            json=event,
            headers={"Authorization": f"Bearer {evi}"},
        )
        self.assertEqual(res.status_code, 200)

        res = client.post(
            "/api/v1/engines/register",
            json={
                "engine_id": "eng_bootstrap",
                "engine_type": "custom",
                "engine_version": "1.0",
            },
            headers=bootstrap,
        )
        self.assertEqual(res.status_code, 200)

    def test_standard_run_events_create_and_update_run(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        ingest = {"Authorization": "Bearer test-ingest-token"}
        admin = {"X-Admin-Token": "test-admin-token"}

        res = client.post(
            "/api/v1/engines/register",
            json={
                "engine_id": "skilllite-local",
                "engine_type": "skilllite",
                "engine_version": "0.1.29",
            },
            headers=ingest,
        )
        self.assertEqual(res.status_code, 200)
        evi = res.json().get("ingest_token")
        self.assertTrue(evi and str(evi).startswith("evi_"))
        scoped = {"Authorization": f"Bearer {evi}"}

        started = {
            "event_type": "run.started",
            "run_id": "run-evt-1",
            "tenant_id": "company-a",
            "team_id": "growth-team",
            "agent_id": "agent-001",
            "engine_id": "skilllite-local",
            "engine_type": "skilllite",
            "engine_version": "0.1.29",
            "task_id": "task-xxx",
            "status": "running",
            "ts": "2026-05-25T09:00:00Z",
            "signals": {"source": "test"},
        }
        res = client.post("/api/v1/events", json=started, headers=scoped)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["run"]["status"], "running")

        completed = {
            **started,
            "event_type": "run.completed",
            "status": "succeeded",
            "exit_code": 0,
            "ts": "2026-05-25T09:01:00Z",
            "signals": {"task_completed": True},
            "seq": 1,
        }
        res = client.post("/api/v1/runs/run-evt-1/events", json=completed, headers=scoped)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["run"]["status"], "succeeded")

        run = client.get("/api/v1/runs/run-evt-1", headers=admin).json()
        self.assertEqual(run["tenant_id"], "company-a")
        self.assertEqual(run["team_id"], "growth-team")
        self.assertEqual(run["agent_id"], "agent-001")
        self.assertEqual(run["engine_type"], "skilllite")
        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["signals"], {"task_completed": True})

        events = client.get("/api/v1/runs/run-evt-1/events", headers=admin).json()["events"]
        self.assertEqual([e["event_type"] for e in events], ["run.started", "run.completed"])


class LegacyGatewayMeteringTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "EVOTOWN_GATEWAY_API_KEYS": "legacy-secret-key",
                "EVOTOWN_GATEWAY_LEGACY_MONTHLY_TOKEN_LIMIT": "100",
                "EVOTOWN_GATEWAY_LEGACY_BURST_RPM": "2",
            },
            clear=False,
        )
        self._env_patch.start()
        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_legacy_key_gets_synthetic_key_id(self) -> None:
        identity = _resolve_gateway_identity("legacy-secret-key")
        self.assertIsNotNone(identity)
        assert identity is not None
        self.assertEqual(identity["source"], "legacy_env")
        self.assertTrue(identity["key_id"].startswith("legacy:"))
        self.assertEqual(identity["key_id"], legacy_key_id("legacy-secret-key"))

    def test_legacy_monthly_quota_uses_synthetic_key_id(self) -> None:
        identity = _resolve_gateway_identity("legacy-secret-key")
        assert identity is not None
        key_id = identity["key_id"]
        gateway_store.record_request(
            {
                "request_id": "gw_legacy1",
                "conversation_id": "c1",
                "api_key_label": "legacy",
                "account_id": "",
                "key_id": key_id,
                "agent_id": "",
                "team_id": "",
                "engine_id": "",
                "model": "m",
                "status_code": 200,
                "total_tokens": 100,
                "latency_ms": 1,
                "risk_status": "allowed",
                "request_excerpt": "",
                "response_excerpt": "",
                "error": "",
            }
        )
        usage = gateway_store.monthly_usage_for_key(key_id)
        allowed, reason = accounts_store.check_monthly_quota(identity, usage)
        self.assertFalse(allowed)
        self.assertEqual(reason, "monthly_token_limit_exceeded")

    def test_admin_token_not_legacy_gateway_without_dev_flag(self) -> None:
        with patch.dict(os.environ, {"ADMIN_TOKEN": "admin-only", "EVOTOWN_GATEWAY_API_KEYS": ""}, clear=False):
            from core import auth as auth_mod
            import importlib
            importlib.reload(auth_mod)
            self.assertIsNone(auth_mod._resolve_gateway_identity("admin-only"))

    def test_admin_token_legacy_gateway_with_dev_flag(self) -> None:
        with patch.dict(
            os.environ,
            {
                "ADMIN_TOKEN": "admin-only",
                "EVOTOWN_GATEWAY_API_KEYS": "",
                "EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY": "1",
            },
            clear=False,
        ):
            from core import auth as auth_mod
            import importlib
            importlib.reload(auth_mod)
            identity = auth_mod._resolve_gateway_identity("admin-only")
            self.assertIsNotNone(identity)
            assert identity is not None
            self.assertTrue(identity["key_id"].startswith("legacy:"))


class ProductionHardeningTest(unittest.TestCase):
    def test_hardening_ok_when_production_defaults(self) -> None:
        with patch.dict(
            os.environ,
            {
                "ADMIN_TOKEN": "admin",
                "EVOTOWN_ENGINE_INGEST_TOKEN": "ingest",
                "EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY": "0",
                "EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK": "0",
                "EVOTOWN_ALLOW_PUBLIC_REGISTER": "0",
                "CORS_ORIGINS": "https://evotown.example.com",
            },
            clear=False,
        ):
            from core import auth as auth_mod
            import importlib
            importlib.reload(auth_mod)
            self.assertEqual(auth_mod.production_hardening_issues(), [])
            status = auth_mod.security_status()
            self.assertTrue(status["hardening_ok"])
            self.assertEqual(status["dev_admin_as_gateway"], "disabled")
            self.assertEqual(status["public_register"], "disabled")

    def test_hardening_fails_on_dev_gateway_and_star_cors(self) -> None:
        with patch.dict(
            os.environ,
            {
                "EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY": "1",
                "EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK": "0",
                "EVOTOWN_ALLOW_PUBLIC_REGISTER": "0",
                "CORS_ORIGINS": "*",
            },
            clear=False,
        ):
            from core import auth as auth_mod
            import importlib
            importlib.reload(auth_mod)
            issues = auth_mod.production_hardening_issues()
            self.assertTrue(any("ADMIN_AS_GATEWAY" in i for i in issues))
            self.assertTrue(any("CORS_ORIGINS" in i for i in issues))
            status = auth_mod.security_status()
            self.assertFalse(status["hardening_ok"])
            self.assertTrue(any("CORS_ORIGINS" in w for w in status["security_warnings"]))

    def test_hardening_fails_on_public_register(self) -> None:
        with patch.dict(
            os.environ,
            {
                "EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY": "0",
                "EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK": "0",
                "EVOTOWN_ALLOW_PUBLIC_REGISTER": "1",
                "CORS_ORIGINS": "https://evotown.example.com",
            },
            clear=False,
        ):
            from core import auth as auth_mod
            import importlib
            importlib.reload(auth_mod)
            issues = auth_mod.production_hardening_issues()
            self.assertTrue(any("PUBLIC_REGISTER" in i for i in issues))


if __name__ == "__main__":
    unittest.main()
