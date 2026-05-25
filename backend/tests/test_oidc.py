"""OIDC SSO configuration surface."""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch


class OidcAuthTest(unittest.TestCase):
    def test_oidc_status_disabled_by_default(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        with patch.dict(os.environ, {}, clear=False):
            importlib.reload(main)
            client = TestClient(main.app)
            status = client.get("/api/v1/auth/oidc/status")
            self.assertEqual(status.status_code, 200)
            body = status.json()
            self.assertFalse(body["enabled"])

    def test_oidc_status_enabled_with_env(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        env = {
            "EVOTOWN_OIDC_ISSUER": "https://idp.example.com",
            "EVOTOWN_OIDC_CLIENT_ID": "evotown",
            "EVOTOWN_OIDC_CLIENT_SECRET": "secret",
            "EVOTOWN_PUBLIC_URL": "https://evotown.test",
        }
        with patch.dict(os.environ, env, clear=False):
            importlib.reload(main)
            client = TestClient(main.app)
            status = client.get("/api/v1/auth/oidc/status")
            self.assertEqual(status.status_code, 200)
            body = status.json()
            self.assertTrue(body["enabled"])
            self.assertIn("redirect_uri", body)


if __name__ == "__main__":
    unittest.main()
