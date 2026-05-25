"""Gateway model route resolution and admin CRUD."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch


class GatewayRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "EVOTOWN_DATA_DIR": self._tmpdir.name,
                "ADMIN_TOKEN": "test-admin-token",
            },
            clear=False,
        )
        self._env_patch.start()
        from infra import gateway_routes

        gateway_routes._conn = None  # noqa: SLF001

    def tearDown(self) -> None:
        from infra import gateway_routes

        gateway_routes._conn = None  # noqa: SLF001
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def test_resolve_global_team_and_account_scope(self) -> None:
        from infra import gateway_routes

        gateway_routes.create_route(alias="enterprise-default", target_model="gpt-4o-mini", priority=10)
        gateway_routes.create_route(
            alias="enterprise-default",
            target_model="team-model",
            team_id="team-a",
            priority=5,
        )
        gateway_routes.create_route(
            alias="enterprise-default",
            target_model="acc-model",
            account_id="acc_1",
            priority=1,
        )

        target, route = gateway_routes.resolve_target_model("enterprise-default")
        self.assertEqual(target, "gpt-4o-mini")

        target, route = gateway_routes.resolve_target_model("enterprise-default", team_id="team-a")
        self.assertEqual(target, "team-model")

        target, route = gateway_routes.resolve_target_model(
            "enterprise-default",
            team_id="team-a",
            account_id="acc_1",
        )
        self.assertEqual(target, "acc-model")
        self.assertEqual(route["target_model"], "acc-model")

    def test_admin_api_crud(self) -> None:
        from fastapi.testclient import TestClient
        import importlib
        import main

        importlib.reload(main)
        client = TestClient(main.app)
        admin = {"X-Admin-Token": "test-admin-token"}

        created = client.post(
            "/api/gateway/v1/model-routes",
            json={"alias": "corp-chat", "target_model": "azure/gpt-4o", "description": "default"},
            headers=admin,
        )
        self.assertEqual(created.status_code, 200)
        route_id = created.json()["route"]["route_id"]

        listed = client.get("/api/gateway/v1/model-routes", headers=admin)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["routes"]), 1)

        patched = client.patch(
            f"/api/gateway/v1/model-routes/{route_id}",
            json={"enabled": False},
            headers=admin,
        )
        self.assertEqual(patched.status_code, 200)
        self.assertFalse(patched.json()["route"]["enabled"])

        deleted = client.delete(f"/api/gateway/v1/model-routes/{route_id}", headers=admin)
        self.assertEqual(deleted.status_code, 200)


if __name__ == "__main__":
    unittest.main()
