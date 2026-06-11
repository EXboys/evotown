"""Evotown-managed upstream models and gateway direct routing."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient


class GatewayUpstreamModelsTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin-token",
                "EVOTOWN_GATEWAY_API_KEYS": "gw-test-key",
            },
            clear=False,
        )
        self._env_patch.start()
        from infra import gateway_models
        from infra import gateway_routes

        gateway_models._conn = None  # noqa: SLF001
        gateway_routes._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import gateway_models
        from infra import gateway_routes

        gateway_models._conn = None  # noqa: SLF001
        gateway_routes._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_crud_masks_api_key(self) -> None:
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}
        created = client.post(
            "/api/gateway/v1/upstream-models",
            headers=admin,
            json={
                "model_name": "corp-gpt",
                "api_base": "https://api.example.com/v1",
                "api_key": "sk-secret-key-1234",
                "provider_label": "Example",
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        model = created.json()["model"]
        self.assertEqual(model["model_name"], "corp-gpt")
        self.assertTrue(model["api_key_set"])
        self.assertIn("1234", model["api_key_hint"])
        self.assertNotIn("api_key", model)

        listed = client.get("/api/gateway/v1/upstream-models", headers=admin)
        self.assertEqual(listed.status_code, 200)
        rows = listed.json()["models"]
        self.assertEqual(len(rows), 1)
        self.assertNotIn("sk-secret", str(rows[0]))

    def test_prepare_chat_uses_managed_upstream_without_litellm(self) -> None:
        from infra import gateway_models
        from infra import gateway_upstream

        gateway_models.create_model(
            model_name="corp-gpt",
            api_base="https://api.example.com/v1",
            api_key="sk-test",
            litellm_model="gpt-4o-mini",
        )
        with patch.dict(os.environ, {"LITELLM_BASE_URL": ""}, clear=False):
            target, headers, body = gateway_upstream.build_upstream_call(
                {"model": "corp-gpt", "messages": [{"role": "user", "content": "hi"}]},
                "corp-gpt",
            )
        self.assertEqual(target, "https://api.example.com/v1/chat/completions")
        self.assertEqual(body["model"], "gpt-4o-mini")
        self.assertEqual(headers["Authorization"], "Bearer sk-test")

    def test_anthropic_managed_upstream_routes_through_litellm(self) -> None:
        from infra import gateway_models
        from infra import gateway_upstream

        gateway_models.create_model(
            model_name="corp-qwen",
            api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key="dashscope-secret",
            litellm_model="dashscope/qwen3-coder-plus",
        )
        with patch.dict(
            os.environ,
            {
                "LITELLM_BASE_URL": "",
                "LITELLM_ANTHROPIC_BASE_URL": "http://litellm.test/v1",
                "LITELLM_MASTER_KEY": "litellm-master",
            },
            clear=False,
        ):
            target, headers, body = gateway_upstream.build_anthropic_upstream_call(
                {"model": "corp-qwen", "max_tokens": 64, "messages": [{"role": "user", "content": "hi"}]},
                "corp-qwen",
                request_headers={"anthropic-version": "2023-06-01"},
            )

        self.assertEqual(target, "http://litellm.test/v1/messages")
        self.assertEqual(body["model"], "dashscope/qwen3-coder-plus")
        self.assertEqual(headers["Authorization"], "Bearer litellm-master")
        self.assertEqual(headers["anthropic-version"], "2023-06-01")
        self.assertNotIn("x-api-key", headers)
