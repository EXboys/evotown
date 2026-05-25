"""Smoke tests for gateway account and API key management."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infra import accounts as accounts_store


class AccountsStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(os.environ, {"EVOTOWN_DATA_DIR": self._tmpdir.name})
        self._env_patch.start()
        accounts_store._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        accounts_store._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_create_account_issue_key_and_lookup(self) -> None:
        account = accounts_store.create_account(name="Team Alpha", team_id="platform")
        self.assertTrue(account["account_id"].startswith("acc_"))

        key_record, secret = accounts_store.create_api_key(account["account_id"], label="laptop-01")
        self.assertTrue(secret.startswith(accounts_store.KEY_PREFIX))
        self.assertEqual(key_record["label"], "laptop-01")

        resolved = accounts_store.lookup_api_key(secret)
        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertEqual(resolved["account_id"], account["account_id"])
        self.assertEqual(resolved["key_id"], key_record["key_id"])

    def test_revoke_key_blocks_lookup(self) -> None:
        account = accounts_store.create_account(name="Revoke Test")
        key_record, secret = accounts_store.create_api_key(account["account_id"])
        accounts_store.revoke_api_key(key_record["key_id"])
        self.assertIsNone(accounts_store.lookup_api_key(secret))

    def test_disabled_account_blocks_lookup(self) -> None:
        account = accounts_store.create_account(name="Disabled")
        _, secret = accounts_store.create_api_key(account["account_id"])
        accounts_store.update_account(account["account_id"], status="disabled")
        self.assertIsNone(accounts_store.lookup_api_key(secret))

    def test_db_file_created(self) -> None:
        accounts_store.create_account(name="Persist")
        db_path = Path(self._tmpdir.name) / "accounts.db"
        self.assertTrue(db_path.is_file())


if __name__ == "__main__":
    unittest.main()
