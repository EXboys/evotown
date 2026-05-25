"""OpenClaw integration endpoints."""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch


class IntegrationsApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._env_patch = patch.dict(
            os.environ,
            {"EVOTOWN_PUBLIC_URL": "https://evotown.test"},
            clear=False,
        )
        self._env_patch.start()

    def tearDown(self) -> None:
        self._env_patch.stop()

    def test_openclaw_manifest_and_install_guide(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)

        manifest = client.get("/api/v1/integrations/openclaw/manifest")
        self.assertEqual(manifest.status_code, 200)
        plugin = manifest.json()["plugin"]
        self.assertEqual(plugin["id"], "evotown")
        self.assertEqual(plugin["evotown_public_url"], "https://evotown.test")

        guide = client.get("/api/v1/integrations/openclaw/install")
        self.assertEqual(guide.status_code, 200)
        self.assertEqual(guide.json()["runtime"], "openclaw")


if __name__ == "__main__":
    unittest.main()
