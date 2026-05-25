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


if __name__ == "__main__":
    unittest.main()
