"""Tests for gateway auth scope and monthly quota enforcement."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from infra import accounts as accounts_store
from infra import gateway as gateway_store


class GatewayAuthQuotaTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(os.environ, {"EVOTOWN_DATA_DIR": self._tmpdir.name})
        self._env_patch.start()
        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_scope_missing_blocks_chat(self) -> None:
        from fastapi import HTTPException
        from core.auth import _assert_gateway_scope

        with self.assertRaises(HTTPException):
            _assert_gateway_scope({"scopes": ["gateway.read"]}, "gateway.chat")

    def test_monthly_token_quota_blocks(self) -> None:
        account = accounts_store.create_account(name="Quota")
        key_record, _ = accounts_store.create_api_key(
            account["account_id"],
            monthly_token_limit=100,
        )
        gateway_store.record_request(
            {
                "request_id": "gw_test1",
                "conversation_id": "c1",
                "api_key_label": "t",
                "account_id": account["account_id"],
                "key_id": key_record["key_id"],
                "agent_id": "",
                "team_id": "",
                "engine_id": "",
                "model": "gpt-4",
                "status_code": 200,
                "prompt_tokens": 60,
                "completion_tokens": 40,
                "total_tokens": 100,
                "cost_usd": 0.01,
                "latency_ms": 10,
                "risk_status": "allowed",
                "request_excerpt": "",
                "response_excerpt": "",
                "error": "",
            }
        )
        usage = gateway_store.monthly_usage_for_key(key_record["key_id"])
        allowed, reason = accounts_store.check_monthly_quota(key_record, usage)
        self.assertFalse(allowed)
        self.assertEqual(reason, "monthly_token_limit_exceeded")

    def test_zero_limits_mean_unlimited(self) -> None:
        account = accounts_store.create_account(name="Unlimited")
        key_record, _ = accounts_store.create_api_key(account["account_id"])
        usage = {"total_tokens": 999999, "cost_usd": 999.0}
        allowed, reason = accounts_store.check_monthly_quota(key_record, usage)
        self.assertTrue(allowed)
        self.assertEqual(reason, "")


class GatewayIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "integration-admin-token",
                "LITELLM_BASE_URL": "",
            },
            clear=False,
        )
        self._env_patch.start()
        self._dotenv_patch = patch("dotenv.load_dotenv")
        self._dotenv_patch.start()
        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_admin_read_auth_scope_and_quota(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "integration-admin-token"}

        self.assertEqual(client.get("/api/v1/accounts").status_code, 403)

        acc = client.post("/api/v1/accounts", json={"name": "Integration"}, headers=admin)
        self.assertEqual(acc.status_code, 200)
        acc_id = acc.json()["account"]["account_id"]

        limited = client.post(
            f"/api/v1/accounts/{acc_id}/keys",
            json={"label": "limited", "monthly_token_limit": 50},
            headers=admin,
        )
        self.assertEqual(limited.status_code, 200)
        key_id = limited.json()["key"]["key_id"]
        secret = limited.json()["secret"]

        readonly = client.post(
            f"/api/v1/accounts/{acc_id}/keys",
            json={"label": "readonly", "scopes": ["gateway.read"]},
            headers=admin,
        )
        read_secret = readonly.json()["secret"]
        self.assertEqual(
            client.post(
                "/api/gateway/v1/chat/completions",
                json={"model": "x", "messages": []},
                headers={"Authorization": f"Bearer {read_secret}"},
            ).status_code,
            403,
        )

        gateway_store.record_request(
            {
                "request_id": "gw_int",
                "conversation_id": "c1",
                "api_key_label": "limited",
                "account_id": acc_id,
                "key_id": key_id,
                "agent_id": "",
                "team_id": "",
                "engine_id": "",
                "model": "m",
                "status_code": 200,
                "prompt_tokens": 50,
                "completion_tokens": 0,
                "total_tokens": 50,
                "cost_usd": 0,
                "latency_ms": 1,
                "risk_status": "allowed",
                "request_excerpt": "",
                "response_excerpt": "",
                "error": "",
            }
        )
        over = client.post(
            "/api/gateway/v1/chat/completions",
            json={"model": "x", "messages": []},
            headers={"Authorization": f"Bearer {secret}"},
        )
        self.assertEqual(over.status_code, 429)

        self.assertEqual(client.get("/api/v1/accounts", headers=admin).status_code, 200)


if __name__ == "__main__":
    unittest.main()
