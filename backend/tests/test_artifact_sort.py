"""Tests for post-run artifact sorting."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from infra import artifact_sort


class ArtifactSortTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = Path(self._tmpdir.name)
        self._env_patch = patch.dict(os.environ, {}, clear=False)
        self._env_patch.start()
        os.environ.pop("EVOTOWN_ARTIFACT_SORT_RULES", None)

    def tearDown(self) -> None:
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _artifact(self, rel: str, content: bytes = b"x") -> dict:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return {
            "path": rel,
            "bytes": len(content),
            "sha256": "abc",
        }

    def test_html_moves_to_dashboard(self) -> None:
        artifacts = [self._artifact("report.html", b"<html></html>")]
        updated, moved, warning = artifact_sort.sort_artifacts(
            self.root,
            artifacts,
            new_paths={"report.html"},
            run_id="run_test1234",
        )
        self.assertIsNone(warning)
        self.assertEqual(moved, [{"from": "report.html", "to": "dashboard/report.html"}])
        self.assertEqual(updated[0]["path"], "dashboard/report.html")
        self.assertEqual(updated[0]["original_path"], "report.html")
        self.assertTrue((self.root / "dashboard/report.html").is_file())
        self.assertFalse((self.root / "report.html").exists())

    def test_pdf_moves_to_downloads(self) -> None:
        artifacts = [self._artifact("data.pdf", b"%PDF")]
        updated, moved, _ = artifact_sort.sort_artifacts(
            self.root,
            artifacts,
            new_paths={"data.pdf"},
            run_id="run_test1234",
        )
        self.assertEqual(moved[0]["to"], "downloads/data.pdf")
        self.assertEqual(updated[0]["path"], "downloads/data.pdf")

    def test_skills_path_not_moved(self) -> None:
        rel = "skills/demo/script.py"
        artifacts = [self._artifact(rel, b"print('x')")]
        updated, moved, _ = artifact_sort.sort_artifacts(
            self.root,
            artifacts,
            new_paths={rel},
            run_id="run_test1234",
        )
        self.assertEqual(moved, [])
        self.assertEqual(updated[0]["path"], rel)
        self.assertTrue((self.root / rel).is_file())

    def test_already_sorted_prefix_not_moved(self) -> None:
        rel = "dashboard/index.html"
        artifacts = [self._artifact(rel, b"<html></html>")]
        updated, moved, _ = artifact_sort.sort_artifacts(
            self.root,
            artifacts,
            new_paths={rel},
            run_id="run_test1234",
        )
        self.assertEqual(moved, [])
        self.assertEqual(updated[0]["path"], rel)

    def test_conflict_renamed_with_run_id(self) -> None:
        (self.root / "dashboard").mkdir(parents=True, exist_ok=True)
        (self.root / "dashboard/report.html").write_text("old", encoding="utf-8")
        artifacts = [self._artifact("report.html", b"<html>new</html>")]
        updated, moved, _ = artifact_sort.sort_artifacts(
            self.root,
            artifacts,
            new_paths={"report.html"},
            run_id="run_abcd1234",
        )
        self.assertEqual(moved[0]["to"], "dashboard/report_run_abcd.html")
        self.assertEqual(updated[0]["path"], "dashboard/report_run_abcd.html")

    def test_no_match_stays_in_place(self) -> None:
        rel = "widget.py"
        artifacts = [self._artifact(rel, b"pass")]
        updated, moved, _ = artifact_sort.sort_artifacts(
            self.root,
            artifacts,
            new_paths={rel},
            run_id="run_test1234",
        )
        self.assertEqual(moved, [])
        self.assertEqual(updated[0]["path"], rel)

    def test_invalid_env_falls_back_to_defaults(self) -> None:
        os.environ["EVOTOWN_ARTIFACT_SORT_RULES"] = "{not json"
        artifacts = [self._artifact("page.html", b"<html></html>")]
        updated, moved, warning = artifact_sort.sort_artifacts(
            self.root,
            artifacts,
            new_paths={"page.html"},
            run_id="run_test1234",
        )
        self.assertIsNotNone(warning)
        self.assertEqual(moved[0]["to"], "dashboard/page.html")
        self.assertEqual(updated[0]["path"], "dashboard/page.html")

    def test_custom_rules_via_env(self) -> None:
        os.environ["EVOTOWN_ARTIFACT_SORT_RULES"] = json.dumps(
            [{"match": {"ext": ["csv"]}, "dest": "dashboard"}],
        )
        artifacts = [self._artifact("metrics.csv", b"a,b\n1,2")]
        updated, moved, warning = artifact_sort.sort_artifacts(
            self.root,
            artifacts,
            new_paths={"metrics.csv"},
            run_id="run_test1234",
        )
        self.assertIsNone(warning)
        self.assertEqual(moved[0]["to"], "dashboard/metrics.csv")
        self.assertEqual(updated[0]["path"], "dashboard/metrics.csv")


if __name__ == "__main__":
    unittest.main()
