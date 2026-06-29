"""Tests for workspace file sharing between agents."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class WorkspaceShareApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin",
                "EVOTOWN_CLAUDE_CODE_COMMAND": "",
                "EVOTOWN_CLAUDE_EXECUTION_MODE": "dry-run",
                "ANTHROPIC_API_KEY": "",
            },
            clear=False,
        )
        self._env_patch.start()
        from infra import accounts, claude_agent_runs, knowledge, skill_market, agents

        accounts._conn = None  # noqa: SLF001
        claude_agent_runs._conn = None  # noqa: SLF001
        knowledge._conn = None  # noqa: SLF001
        skill_market._conn = None  # noqa: SLF001
        agents._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import accounts, claude_agent_runs, knowledge, skill_market, agents

        accounts._conn = None  # noqa: SLF001
        claude_agent_runs._conn = None  # noqa: SLF001
        knowledge._conn = None  # noqa: SLF001
        skill_market._conn = None  # noqa: SLF001
        agents._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        return TestClient(main.app)

    def _account_key(self, name: str) -> tuple[dict, str]:
        from infra import accounts

        account = accounts.create_account(name=name)
        _key, secret = accounts.create_api_key(
            account["account_id"],
            label=f"{name}-console",
            scopes=list(accounts.DEFAULT_CONSOLE_KEY_SCOPES),
        )
        return account, secret

    def _create_agent(self, client, key: str, name: str) -> dict:
        resp = client.post(
            "/api/v1/agents",
            headers={"Authorization": f"Bearer {key}"},
            json={"name": name},
        )
        self.assertEqual(resp.status_code, 200)
        return resp.json()["agent"]

    def _write_file(self, agent: dict, rel: str, content: str) -> None:
        from infra import agents as agents_store

        target = agents_store.resolve_agent_path(agent, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def test_share_copies_files_preserving_structure(self) -> None:
        from infra import agents as agents_store

        client = self._client()
        _alice, alice_key = self._account_key("Alice")
        source = self._create_agent(client, alice_key, "Source")
        target = self._create_agent(client, alice_key, "Target")

        self._write_file(source, "index.html", "<html><link rel='stylesheet' href='assets/style.css'></html>")
        self._write_file(source, "assets/style.css", "body { color: red; }")

        share = client.post(
            f"/api/v1/agents/{source['agent_id']}/share",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={
                "paths": ["index.html", "assets/style.css"],
                "target_agent_id": target["agent_id"],
            },
        )
        self.assertEqual(share.status_code, 200, share.text)
        payload = share.json()
        self.assertEqual(payload["source_agent_id"], source["agent_id"])
        self.assertEqual(payload["target_agent_id"], target["agent_id"])
        self.assertTrue(payload["dest_prefix"].startswith("shared/"))
        self.assertEqual(len(payload["copied"]), 2)

        dest_html = agents_store.resolve_agent_path(
            target,
            f"{payload['dest_prefix']}index.html",
        )
        dest_css = agents_store.resolve_agent_path(
            target,
            f"{payload['dest_prefix']}assets/style.css",
        )
        self.assertTrue(dest_html.is_file())
        self.assertTrue(dest_css.is_file())
        self.assertIn("color: red", dest_css.read_text(encoding="utf-8"))

        serve = client.get(
            f"/api/v1/agents/{target['agent_id']}/serve/{payload['dest_prefix']}index.html",
            headers={"Authorization": f"Bearer {alice_key}"},
        )
        self.assertEqual(serve.status_code, 200)
        self.assertIn("text/html", serve.headers.get("content-type", ""))

    def test_share_forbidden_without_target_access(self) -> None:
        client = self._client()
        _alice, alice_key = self._account_key("Alice")
        _bob, bob_key = self._account_key("Bob")
        source = self._create_agent(client, alice_key, "Alice Source")
        target = self._create_agent(client, bob_key, "Bob Target")
        self._write_file(source, "index.html", "<html></html>")

        denied = client.post(
            f"/api/v1/agents/{source['agent_id']}/share",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={"paths": ["index.html"], "target_agent_id": target["agent_id"]},
        )
        self.assertEqual(denied.status_code, 403)

    def test_share_rejects_path_traversal(self) -> None:
        client = self._client()
        _alice, alice_key = self._account_key("Alice")
        source = self._create_agent(client, alice_key, "Guard Source")
        target = self._create_agent(client, alice_key, "Guard Target")
        self._write_file(source, "index.html", "<html></html>")

        bad = client.post(
            f"/api/v1/agents/{source['agent_id']}/share",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={"paths": ["../escape.html"], "target_agent_id": target["agent_id"]},
        )
        self.assertEqual(bad.status_code, 400)

    def test_share_conflict_returns_409(self) -> None:
        client = self._client()
        _alice, alice_key = self._account_key("Alice")
        source = self._create_agent(client, alice_key, "Conflict Source")
        target = self._create_agent(client, alice_key, "Conflict Target")
        self._write_file(source, "index.html", "<html>v1</html>")

        first = client.post(
            f"/api/v1/agents/{source['agent_id']}/share",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={"paths": ["index.html"], "target_agent_id": target["agent_id"]},
        )
        self.assertEqual(first.status_code, 200)

        second = client.post(
            f"/api/v1/agents/{source['agent_id']}/share",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={"paths": ["index.html"], "target_agent_id": target["agent_id"], "overwrite": False},
        )
        self.assertEqual(second.status_code, 409)

    def test_share_cross_account_when_member(self) -> None:
        from infra import agents as agents_store

        client = self._client()
        alice, alice_key = self._account_key("Alice")
        _bob, bob_key = self._account_key("Bob")
        source = self._create_agent(client, alice_key, "Alice Page")
        target = self._create_agent(client, bob_key, "Bob Page")
        agents_store.bind_account_to_agent(alice["account_id"], target["agent_id"])
        self._write_file(source, "report.html", "<html>shared report</html>")

        share = client.post(
            f"/api/v1/agents/{source['agent_id']}/share",
            headers={"Authorization": f"Bearer {alice_key}"},
            json={"paths": ["report.html"], "target_agent_id": target["agent_id"]},
        )
        self.assertEqual(share.status_code, 200)

        serve = client.get(
            f"/api/v1/agents/{target['agent_id']}/serve/{share.json()['dest_prefix']}report.html",
            headers={"Authorization": f"Bearer {bob_key}"},
        )
        self.assertEqual(serve.status_code, 200)


if __name__ == "__main__":
    unittest.main()
