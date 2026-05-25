"""Tests for gateway SSE streaming proxy."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from api.routers import gateway as gateway_router


class GatewayStreamHelperTest(unittest.TestCase):
    def test_parse_sse_usage_extracts_tokens(self) -> None:
        usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        line = 'data: {"usage":{"prompt_tokens":3,"completion_tokens":5,"total_tokens":8}}'
        usage, cost = gateway_router._parse_sse_usage(line, usage, 0.0)
        self.assertEqual(usage["total_tokens"], 8)
        self.assertEqual(usage["prompt_tokens"], 3)


class GatewayStreamApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "stream-admin",
                "LITELLM_BASE_URL": "http://litellm.test/v1",
                "LITELLM_MASTER_KEY": "test-master",
            },
            clear=False,
        )
        self._env_patch.start()
        self._dotenv_patch = patch("dotenv.load_dotenv")
        self._dotenv_patch.start()
        from infra import accounts as accounts_store
        from infra import gateway as gateway_store

        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import accounts as accounts_store
        from infra import gateway as gateway_store

        accounts_store._conn = None  # noqa: SLF001
        gateway_store._conn = None  # noqa: SLF001
        self._dotenv_patch.stop()
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_stream_chat_completions_proxies_sse(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "stream-admin"}

        acc = client.post("/api/v1/accounts", json={"name": "Stream User"}, headers=admin)
        acc_id = acc.json()["account"]["account_id"]
        key_resp = client.post(
            f"/api/v1/accounts/{acc_id}/keys",
            json={"label": "stream", "scopes": ["gateway.chat"]},
            headers=admin,
        )
        api_key = key_resp.json()["secret"]

        sse_lines = [
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}',
            "data: [DONE]",
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
                "/api/gateway/v1/chat/completions",
                json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}], "stream": True},
                headers={"Authorization": f"Bearer {api_key}"},
            ) as resp:
                self.assertEqual(resp.status_code, 200)
                self.assertIn("text/event-stream", resp.headers.get("content-type", ""))
                body = b"".join(resp.iter_bytes())
                self.assertIn(b"Hello", body)
                self.assertIn(b"[DONE]", body)

        from infra import gateway as gateway_store

        rows = gateway_store.recent_requests(limit=1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["total_tokens"], 3)


if __name__ == "__main__":
    unittest.main()
