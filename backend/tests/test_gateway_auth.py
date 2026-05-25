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

    def test_burst_rate_limit_blocks(self) -> None:
        account = accounts_store.create_account(name="Burst")
        key_record, _ = accounts_store.create_api_key(account["account_id"], burst_rpm_limit=2)
        for i in range(2):
            gateway_store.record_request(
                {
                    "request_id": f"gw_burst_{i}",
                    "conversation_id": "c1",
                    "api_key_label": "b",
                    "account_id": account["account_id"],
                    "key_id": key_record["key_id"],
                    "agent_id": "",
                    "team_id": "",
                    "engine_id": "",
                    "model": "m",
                    "status_code": 200,
                    "total_tokens": 1,
                    "latency_ms": 1,
                    "risk_status": "allowed",
                    "request_excerpt": "",
                    "response_excerpt": "",
                    "error": "",
                }
            )
        recent = gateway_store.request_count_in_window(key_record["key_id"])
        allowed, reason = accounts_store.check_burst_rate_limit(key_record, recent)
        self.assertFalse(allowed)
        self.assertEqual(reason, "burst_rate_limit_exceeded")

    def test_post_check_updates_risk_status(self) -> None:
        account = accounts_store.create_account(name="Post")
        key_record, _ = accounts_store.create_api_key(account["account_id"], monthly_token_limit=100)
        gateway_store.record_request(
            {
                "request_id": "gw_post",
                "conversation_id": "c1",
                "api_key_label": "p",
                "account_id": account["account_id"],
                "key_id": key_record["key_id"],
                "agent_id": "",
                "team_id": "",
                "engine_id": "",
                "model": "m",
                "status_code": 200,
                "prompt_tokens": 60,
                "completion_tokens": 50,
                "total_tokens": 110,
                "cost_usd": 0,
                "latency_ms": 1,
                "risk_status": "allowed",
                "request_excerpt": "",
                "response_excerpt": "",
                "error": "",
            }
        )
        usage = gateway_store.monthly_usage_for_key(key_record["key_id"])
        allowed, reason = accounts_store.check_monthly_quota(key_record, usage)
        self.assertFalse(allowed)
        gateway_store.update_request_risk_status("gw_post", f"{reason}_post")
        row = gateway_store.get_request("gw_post")
        self.assertEqual(row["risk_status"], "monthly_token_limit_exceeded_post")


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

    def test_burst_rate_limit_returns_429(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "integration-admin-token"}

        acc = client.post("/api/v1/accounts", json={"name": "BurstInt"}, headers=admin).json()
        acc_id = acc["account"]["account_id"]
        created = client.post(
            f"/api/v1/accounts/{acc_id}/keys",
            json={"label": "burst", "burst_rpm_limit": 1},
            headers=admin,
        ).json()
        key_id = created["key"]["key_id"]
        secret = created["secret"]

        gateway_store.record_request(
            {
                "request_id": "gw_burst_int",
                "conversation_id": "c1",
                "api_key_label": "burst",
                "account_id": acc_id,
                "key_id": key_id,
                "agent_id": "",
                "team_id": "",
                "engine_id": "",
                "model": "m",
                "status_code": 200,
                "total_tokens": 1,
                "latency_ms": 1,
                "risk_status": "allowed",
                "request_excerpt": "",
                "response_excerpt": "",
                "error": "",
            }
        )
        resp = client.post(
            "/api/gateway/v1/chat/completions",
            json={"model": "x", "messages": []},
            headers={"Authorization": f"Bearer {secret}"},
        )
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.json()["detail"]["error"], "burst_rate_limit_exceeded")

    def test_post_quota_check_header_on_success(self) -> None:
        from unittest.mock import AsyncMock, MagicMock, patch

        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "integration-admin-token"}

        acc = client.post("/api/v1/accounts", json={"name": "PostInt"}, headers=admin).json()
        acc_id = acc["account"]["account_id"]
        created = client.post(
            f"/api/v1/accounts/{acc_id}/keys",
            json={"label": "post", "monthly_token_limit": 100},
            headers=admin,
        ).json()
        key_id = created["key"]["key_id"]
        secret = created["secret"]

        gateway_store.record_request(
            {
                "request_id": "gw_pre",
                "conversation_id": "c1",
                "api_key_label": "post",
                "account_id": acc_id,
                "key_id": key_id,
                "agent_id": "",
                "team_id": "",
                "engine_id": "",
                "model": "m",
                "status_code": 200,
                "total_tokens": 80,
                "latency_ms": 1,
                "risk_status": "allowed",
                "request_excerpt": "",
                "response_excerpt": "",
                "error": "",
            }
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.is_success = True
        mock_response.json.return_value = {
            "id": "chatcmpl-test",
            "choices": [{"message": {"role": "assistant", "content": "ok"}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
        }

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = None

        with patch.dict(os.environ, {"LITELLM_BASE_URL": "http://litellm.test/v1"}, clear=False):
            importlib.reload(main)
            client = TestClient(main.app)
            with patch("api.routers.gateway.httpx.AsyncClient", return_value=mock_client):
                resp = client.post(
                    "/api/gateway/v1/chat/completions",
                    json={"model": "x", "messages": [{"role": "user", "content": "hi"}]},
                    headers={"Authorization": f"Bearer {secret}"},
                )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("X-Evotown-Quota-Exceeded"), "monthly_token_limit_exceeded_post")
        recorded = gateway_store.recent_requests(limit=1)[0]
        self.assertEqual(recorded["risk_status"], "monthly_token_limit_exceeded_post")


if __name__ == "__main__":
    unittest.main()
