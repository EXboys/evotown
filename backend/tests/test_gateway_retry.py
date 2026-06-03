"""Tests for gateway retry/fallback and auto routing."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from infra import gateway_auto
from infra import gateway_retry
from infra import gateway_routes


class GatewayRetryPolicyTest(unittest.TestCase):
    def test_should_retry_on_503(self) -> None:
        policy = gateway_retry.RetryPolicy.from_dict({})
        self.assertTrue(
            gateway_retry.should_retry_same_model(
                policy=policy,
                status_code=503,
                error_kind="",
                retries_used=0,
            )
        )

    def test_should_not_retry_on_400(self) -> None:
        policy = gateway_retry.RetryPolicy.from_dict({})
        self.assertFalse(
            gateway_retry.should_retry_same_model(
                policy=policy,
                status_code=400,
                error_kind="",
                retries_used=0,
            )
        )

    def test_build_model_chain_dedupes(self) -> None:
        chain = gateway_retry.build_model_chain("a", ["b", "a", "c"], max_hops=2)
        self.assertEqual(chain, ["a", "b", "c"])


class GatewayAutoTest(unittest.TestCase):
    def test_short_prompt_uses_fast_tier(self) -> None:
        body = {"messages": [{"role": "user", "content": "hi"}]}
        policy = {
            "tiers": {"fast": "mini", "balanced": "mid", "strong": "max"},
            "threshold_tokens_fast": 500,
            "threshold_tokens_strong": 8000,
        }
        model, tier, _ = gateway_auto.resolve_auto_model(body, policy)
        self.assertEqual(tier, "fast")
        self.assertEqual(model, "mini")

    def test_tools_force_strong(self) -> None:
        body = {"messages": [{"role": "user", "content": "x"}], "tools": [{"type": "function"}]}
        policy = {"tiers": {"fast": "mini", "balanced": "mid", "strong": "max"}}
        _, tier, reason = gateway_auto.resolve_auto_model(body, policy)
        self.assertEqual(tier, "strong")
        self.assertIn("tools", reason)


class GatewayRoutesResilienceTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(os.environ, {"EVOTOWN_DATA_DIR": self._tmpdir.name}, clear=False)
        self._env_patch.start()
        gateway_routes._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        gateway_routes._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_resolve_model_chain_with_fallbacks(self) -> None:
        gateway_routes.create_route(
            alias="corp",
            target_model="primary",
            fallback_models=["backup-a", "backup-b"],
            enable_fallback=True,
        )
        chain, route, policy, via_alias = gateway_routes.resolve_model_chain("corp")
        self.assertTrue(via_alias)
        self.assertEqual(chain, ["primary", "backup-a", "backup-b"])
        self.assertIsNotNone(route)
        self.assertEqual(policy.max_retries_same_model, 2)

    def test_explicit_model_no_fallback_chain(self) -> None:
        gateway_routes.create_route(
            alias="corp",
            target_model="primary",
            fallback_models=["backup"],
        )
        chain, route, _, via_alias = gateway_routes.resolve_model_chain("unknown-model")
        self.assertFalse(via_alias)
        self.assertIsNone(route)
        self.assertEqual(chain, ["unknown-model"])

    def test_auto_route_type(self) -> None:
        gateway_routes.create_route(
            alias="smart",
            target_model="unused",
            route_type="auto",
            auto_policy={
                "tiers": {"fast": "cheap", "balanced": "mid", "strong": "pro"},
            },
        )
        target, matched = gateway_routes.resolve_target_model(
            "smart",
            body={"messages": [{"role": "user", "content": "hello"}]},
        )
        self.assertEqual(target, "cheap")
        self.assertEqual(matched.get("evotown_auto_tier"), "fast")


class GatewayRetryExecutionTest(unittest.IsolatedAsyncioTestCase):
    async def test_retry_same_model_before_fallback(self) -> None:
        calls: list[str] = []

        def build_call(model: str) -> tuple[str, dict[str, str], dict]:
            calls.append(model)
            return "http://upstream.test/v1/chat/completions", {}, {"model": model}

        responses = [
            httpx.Response(503, json={"error": "unavailable"}),
            httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}),
        ]

        async def fake_post(url, json=None, headers=None):
            return responses.pop(0)

        client = MagicMock()
        client.post = AsyncMock(side_effect=fake_post)

        policy = gateway_retry.RetryPolicy.from_dict({"max_retries_same_model": 1, "max_fallback_hops": 1})
        result = await gateway_retry.post_chat_with_resilience(
            client=client,
            build_call=build_call,
            model_chain=["only"],
            policy=policy,
            timeout_sec=30.0,
        )
        self.assertTrue(result.success)
        self.assertEqual(calls, ["only", "only"])

    async def test_404_falls_back_without_same_model_retry(self) -> None:
        calls: list[str] = []

        def build_call(model: str) -> tuple[str, dict[str, str], dict]:
            calls.append(model)
            return "http://upstream.test/v1/chat/completions", {}, {"model": model}

        responses = [
            httpx.Response(404, json={"error": "model not found"}),
            httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}),
        ]

        client = MagicMock()
        client.post = AsyncMock(side_effect=lambda *a, **k: responses.pop(0))

        policy = gateway_retry.RetryPolicy.from_dict({"max_retries_same_model": 2})
        result = await gateway_retry.post_chat_with_resilience(
            client=client,
            build_call=build_call,
            model_chain=["missing", "backup"],
            policy=policy,
            timeout_sec=30.0,
        )
        self.assertTrue(result.success)
        self.assertEqual(result.final_model, "backup")
        self.assertEqual(calls, ["missing", "backup"])

    async def test_fallback_after_primary_503(self) -> None:
        calls: list[str] = []

        def build_call(model: str) -> tuple[str, dict[str, str], dict]:
            calls.append(model)
            return "http://upstream.test/v1/chat/completions", {}, {"model": model}

        responses = [
            httpx.Response(503, json={"error": "unavailable"}),
            httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}], "usage": {"total_tokens": 1}}),
        ]

        async def fake_post(url, json=None, headers=None):
            return responses.pop(0)

        client = MagicMock()
        client.post = AsyncMock(side_effect=fake_post)

        policy = gateway_retry.RetryPolicy.from_dict({"max_retries_same_model": 0})
        result = await gateway_retry.post_chat_with_resilience(
            client=client,
            build_call=build_call,
            model_chain=["primary", "backup"],
            policy=policy,
            timeout_sec=30.0,
        )
        self.assertTrue(result.success)
        self.assertEqual(result.final_model, "backup")
        self.assertEqual(calls, ["primary", "backup"])


class GatewayChatResilienceIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "retry-int-admin",
                "LITELLM_BASE_URL": "http://litellm.test/v1",
                "LITELLM_MASTER_KEY": "test-master",
            },
            clear=False,
        )
        self._env_patch.start()
        from infra import accounts as accounts_store
        from infra import gateway as gateway_store
        from infra import gateway_routes

        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        gateway_routes._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import accounts as accounts_store
        from infra import gateway as gateway_store
        from infra import gateway_routes

        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        gateway_routes._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_success_sets_resilience_headers(self) -> None:
        from unittest.mock import AsyncMock, MagicMock

        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "retry-int-admin"}

        acc = client.post("/api/v1/accounts", json={"name": "Retry"}, headers=admin).json()
        acc_id = acc["account"]["account_id"]
        secret = client.post(
            f"/api/v1/accounts/{acc_id}/keys",
            json={"label": "gw", "scopes": ["gateway.chat"]},
            headers=admin,
        ).json()["secret"]

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.is_success = True
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "ok"}}],
            "usage": {"total_tokens": 3},
        }
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = None

        importlib.reload(main)
        client = TestClient(main.app)
        with patch("api.routers.gateway.httpx.AsyncClient", return_value=mock_client):
            resp = client.post(
                "/api/gateway/v1/chat/completions",
                json={"model": "test-model", "messages": [{"role": "user", "content": "hi"}]},
                headers={"Authorization": f"Bearer {secret}"},
            )

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.headers.get("X-Evotown-Request-Id", "").startswith("gw_"))
        self.assertEqual(resp.headers.get("X-Evotown-Final-Model"), "test-model")
        self.assertEqual(resp.headers.get("X-Evotown-Upstream-Attempts"), "1")
