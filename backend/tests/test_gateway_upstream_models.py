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
        from api.routers import gateway as gateway_router
        from infra import gateway_models

        gateway_models.create_model(
            model_name="corp-gpt",
            api_base="https://api.example.com/v1",
            api_key="sk-test",
            litellm_model="gpt-4o-mini",
        )
        with patch.dict(os.environ, {"LITELLM_BASE_URL": ""}, clear=False):
            request_id, _conv, model, body, target, headers = gateway_router._prepare_chat_request(  # noqa: SLF001
                {"model": "corp-gpt", "messages": [{"role": "user", "content": "hi"}]},
                identity={"key_label": "t", "account_id": "", "key_id": ""},
                x_evotown_agent_id=None,
                x_evotown_team_id=None,
                x_evotown_engine_id=None,
                x_evotown_conversation_id=None,
            )
        self.assertTrue(request_id.startswith("gw_"))
        self.assertEqual(model, "corp-gpt")
        self.assertEqual(target, "https://api.example.com/v1/chat/completions")
        self.assertEqual(body["model"], "gpt-4o-mini")
        self.assertEqual(headers["Authorization"], "Bearer sk-test")
