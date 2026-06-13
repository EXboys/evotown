"""Tests for workspace vision preflight."""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class WorkspaceVisionTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "EVOTOWN_CLAUDE_VISION_MODEL": "qwen-vl-test",
            },
            clear=False,
        )
        self._env_patch.start()
        from infra import gateway_models, workspaces

        gateway_models._conn = None  # noqa: SLF001
        workspaces._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import gateway_models, workspaces

        gateway_models._conn = None  # noqa: SLF001
        workspaces._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_describe_workspace_images_calls_upstream(self) -> None:
        from infra import gateway_models, workspaces
        from services import workspace_vision

        account_id = "acc_test"
        ws = workspaces.create_workspace(owner_account_id=account_id, name="Vision WS")
        gateway_models.create_model(
            model_name="qwen-vl-test",
            provider_label="qwen",
            api_base="https://vision.example.com/v1",
            api_key="sk-test",
            litellm_model="qwen-vl-plus",
        )
        root = workspaces.resolve_workspace_path(ws)
        rel = "uploads/test.jpg"
        img_path = root / rel
        img_path.parent.mkdir(parents=True, exist_ok=True)
        from PIL import Image

        Image.new("RGB", (64, 48), color=(120, 80, 200)).save(img_path, format="JPEG")

        mock_resp = unittest.mock.Mock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "这是一张紫色色块的测试图。"}}],
        }

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("services.workspace_vision.httpx.AsyncClient", return_value=mock_client):
            text = asyncio.run(
                workspace_vision.describe_workspace_images(
                    ws,
                    [rel],
                    user_prompt="分析一下这个图片",
                )
            )

        self.assertIn("紫色", text)
        mock_client.post.assert_called_once()
        sent = mock_client.post.call_args.kwargs["json"]
        content = sent["messages"][0]["content"]
        self.assertTrue(any(item.get("type") == "image_url" for item in content))


if __name__ == "__main__":
    unittest.main()
