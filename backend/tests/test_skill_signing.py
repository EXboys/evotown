"""Skill package HMAC signing."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch


class SkillSigningTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "EVOTOWN_SKILL_SIGNING_SECRET": "test-signing-secret",
                "ADMIN_TOKEN": "test-admin-token",
            },
            clear=False,
        )
        self._env_patch.start()
        from infra import skill_market

        skill_market._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import skill_market

        skill_market._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_upload_and_manifest_include_signature(self) -> None:
        import base64
        from fastapi.testclient import TestClient
        import importlib
        import main
        from infra import skill_signing

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}
        raw = b"signed skill package"

        upload = client.post(
            "/api/v1/skill-packages",
            json={
                "skill_id": "signed-skill",
                "name": "Signed",
                "description": "signed",
                "version": "1.0.0",
                "runtime_targets": ["openclaw"],
                "visibility": "company",
                "tags": [],
                "readme": "",
                "dependencies": [],
                "filename": "signed.zip",
                "content_base64": base64.b64encode(raw).decode("ascii"),
            },
            headers=admin,
        )
        self.assertEqual(upload.status_code, 200)
        skill = upload.json()["skill"]
        digest = skill["package_sha256"]
        sig = skill["package_signature"]
        self.assertTrue(skill_signing.verify_digest_hex(digest, sig))

        from infra import skill_market

        self.assertTrue(skill_market.verify_package_integrity("signed-skill"))


if __name__ == "__main__":
    unittest.main()
