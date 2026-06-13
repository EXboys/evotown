"""Tests for Evotown's Anthropic-compatible gateway proxy."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch


class GatewayAnthropicApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "anthropic-admin",
                "LITELLM_BASE_URL": "http://litellm.test/v1",
                "LITELLM_ANTHROPIC_BASE_URL": "http://litellm-anthropic.test/v1",
                "LITELLM_MASTER_KEY": "test-master",
            },
            clear=False,
        )
        self._env_patch.start()
        self._dotenv_patch = patch("dotenv.load_dotenv")
        self._dotenv_patch.start()

        from infra import accounts as accounts_store
        from infra import gateway as gateway_store
        from infra import gateway_models, gateway_routes

        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        gateway_models._conn = None  # noqa: SLF001
        gateway_routes._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import accounts as accounts_store
        from infra import gateway as gateway_store
        from infra import gateway_models, gateway_routes

        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        gateway_models._conn = None  # noqa: SLF001
        gateway_routes._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _client_and_key(self):
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "anthropic-admin"}
        acc = client.post("/api/v1/accounts", json={"name": "Anthropic User"}, headers=admin)
        acc_id = acc.json()["account"]["account_id"]
        key_resp = client.post(
            f"/api/v1/accounts/{acc_id}/keys",
            json={"label": "anthropic", "scopes": ["gateway.chat"]},
            headers=admin,
        )
        return client, key_resp.json()["secret"]

    def test_messages_accepts_x_api_key_and_proxies_to_anthropic_endpoint(self) -> None:
        client, api_key = self._client_and_key()
        calls: list[dict] = []

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def post(self, target, *, json, headers):
                calls.append({"target": target, "json": json, "headers": headers})
                response = MagicMock()
                response.status_code = 200
                response.is_success = True
                response.json.return_value = {
                    "id": "msg_123",
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "text", "text": "ok"}],
                    "model": "claude-test",
                    "usage": {"input_tokens": 2, "output_tokens": 3},
                }
                return response

        with patch("api.routers.gateway.httpx.AsyncClient", return_value=FakeClient()):
            resp = client.post(
                "/api/gateway/anthropic/v1/messages",
                json={
                    "model": "claude-test",
                    "max_tokens": 64,
                    "messages": [{"role": "user", "content": "hi"}],
                },
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )

        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["id"], "msg_123")
        self.assertEqual(calls[0]["target"], "http://litellm-anthropic.test/v1/messages")
        self.assertEqual(calls[0]["headers"]["Authorization"], "Bearer test-master")
        self.assertEqual(calls[0]["headers"]["anthropic-version"], "2023-06-01")
        self.assertEqual(calls[0]["json"]["model"], "claude-test")

        from infra import gateway as gateway_store

        rows = gateway_store.recent_requests(limit=1)
        self.assertEqual(rows[0]["prompt_tokens"], 2)
        self.assertEqual(rows[0]["completion_tokens"], 3)
        self.assertEqual(rows[0]["total_tokens"], 5)

    def test_messages_routes_managed_upstream_to_anthropic_api_base(self) -> None:
        from infra import gateway_models

        anthropic_base = "https://dashscope.aliyuncs.com/apps/anthropic/v1"
        gateway_models.create_model(
            model_name="corp-qwen",
            api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
            anthropic_api_base=anthropic_base,
            api_key="dashscope-secret",
            litellm_model="dashscope/qwen3-coder-plus",
        )
        client, api_key = self._client_and_key()
        calls: list[dict] = []

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def post(self, target, *, json, headers):
                calls.append({"target": target, "json": json, "headers": headers})
                response = MagicMock()
                response.status_code = 200
                response.is_success = True
                response.json.return_value = {
                    "id": "msg_managed",
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "text", "text": "ok"}],
                    "model": "dashscope/qwen3-coder-plus",
                    "usage": {"input_tokens": 4, "output_tokens": 6},
                }
                return response

        with patch("api.routers.gateway.httpx.AsyncClient", return_value=FakeClient()):
            resp = client.post(
                "/api/gateway/anthropic/v1/messages",
                json={
                    "model": "corp-qwen",
                    "max_tokens": 64,
                    "messages": [{"role": "user", "content": "hi"}],
                },
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )

        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(calls[0]["target"], f"{anthropic_base}/messages")
        self.assertEqual(calls[0]["json"]["model"], "dashscope/qwen3-coder-plus")
        self.assertEqual(calls[0]["headers"]["x-api-key"], "dashscope-secret")
        self.assertEqual(calls[0]["headers"]["anthropic-version"], "2023-06-01")
        self.assertNotIn("Authorization", calls[0]["headers"])

    def test_stream_messages_accepts_bearer_and_preserves_sse(self) -> None:
        client, api_key = self._client_and_key()
        sse_lines = [
            "event: message_start",
            'data: {"type":"message_start","message":{"usage":{"input_tokens":2}}}',
            "",
            "event: content_block_delta",
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
            "",
            "event: message_delta",
            'data: {"type":"message_delta","usage":{"output_tokens":3}}',
            "",
            "event: message_stop",
            'data: {"type":"message_stop"}',
            "",
        ]

        class FakeUpstream:
            status_code = 200

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def aiter_lines(self):
                for line in sse_lines:
                    yield line

            async def aread(self):
                return b""

        class FakeClient:
            def stream(self, *args, **kwargs):
                return FakeUpstream()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def post(self, *args, **kwargs):
                raise AssertionError("non-stream post should not be called")

        with patch("api.routers.gateway.httpx.AsyncClient", return_value=FakeClient()):
            with client.stream(
                "POST",
                "/api/gateway/anthropic/v1/messages",
                json={
                    "model": "claude-test",
                    "max_tokens": 64,
                    "stream": True,
                    "messages": [{"role": "user", "content": "hi"}],
                },
                headers={"Authorization": f"Bearer {api_key}"},
            ) as resp:
                self.assertEqual(resp.status_code, 200)
                body = b"".join(resp.iter_bytes())
                self.assertIn(b"event: content_block_delta", body)
                self.assertIn(b"Hello", body)

        from infra import gateway as gateway_store

        rows = gateway_store.recent_requests(limit=1)
        self.assertEqual(rows[0]["total_tokens"], 5)


if __name__ == "__main__":
    unittest.main()
