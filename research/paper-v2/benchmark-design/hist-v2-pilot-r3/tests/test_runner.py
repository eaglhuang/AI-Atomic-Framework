"""Pilot-r3 runner guards. It does not start the 1740-cell matrix."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT
while REPO != REPO.parent and not (REPO / "atm.mjs").is_file():
    REPO = REPO.parent
sys.path.insert(0, str(ROOT / "src"))

from hist_v2_pilot_r3.runner import (  # noqa: E402
    BINDING_SCHEMA,
    binding_path,
    fixture_from_binding,
    guard_stage,
    load_pilot_items,
    pins,
    run_with_a9,
)
import hist_v2_pilot_r3.runner as runner  # noqa: E402
import tempfile  # noqa: E402


class PilotR3GuardTests(unittest.TestCase):
    def test_main_and_held_out_stay_locked(self) -> None:
        self.assertEqual(guard_stage(["--stage", "main"]), 2)
        self.assertEqual(guard_stage(["--stage=held-out"]), 2)
        self.assertEqual(guard_stage(["heldout"]), 2)
        self.assertIsNone(guard_stage(["run", "--date", "2026-10-15"]))

    def test_fixture_carries_parent_and_head_for_the_known_item(self) -> None:
        _selected, full = load_pilot_items()
        self.assertEqual(len(full), 29)
        self.assertTrue(all(item["set"] == "dev" for item in full))
        item = next(row for row in full if row["id"] == "django:dev:15705_16703:django/db/models/query.py")
        binding = json.loads(binding_path(item["id"]).read_text(encoding="utf-8"))
        self.assertEqual(binding["schema"], BINDING_SCHEMA)
        fixture = fixture_from_binding(item, binding)
        proposal = next(row for row in fixture["proposals"] if row["id"] == 16703)
        self.assertTrue(proposal["parent_text"])
        self.assertTrue(proposal["head_text"])
        self.assertIn("unified_diff", proposal)
        self.assertNotEqual(proposal["parent_text"], fixture["base"])


def _fake(valid: bool, root: Path, tag: str) -> dict:
    workspace = root / f"ws-{tag}"
    workspace.mkdir()
    (workspace / "x").write_text(tag, encoding="utf-8")
    return {
        "workspace": workspace,
        "validity": {"valid": valid, "reasons": [] if valid else ["realtime-monotonic-drift"]},
        "observation": {"tag": tag},
    }


class PilotR3A9Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="r3-a9-"))
        self.staging = self.tmp / "staging"
        self.staging.mkdir()
        self._release = runner._release
        runner._release = lambda workspace: None

    def tearDown(self) -> None:
        runner._release = self._release
        import shutil

        shutil.rmtree(self.tmp, ignore_errors=True)

    def _runner(self, pattern: list[bool]):
        calls = iter(range(len(pattern)))

        def run(_item, _cell):
            index = next(calls)
            return _fake(pattern[index], self.tmp, str(index))

        return run

    def test_pins_hold_v4_and_v3(self) -> None:
        got = pins()
        self.assertEqual(got["arms"], ["steward", "file_lock", "textual_merge_file"])
        self.assertTrue(got["trial_banner"].startswith("pilot-r3"))

    def test_valid_first_attempt_is_kept(self) -> None:
        invalid: list[dict] = []
        outcome, problem = run_with_a9({}, {}, "c", self.staging, invalid, 1740, runner=self._runner([True]))
        self.assertIsNone(problem)
        self.assertEqual(outcome["observation"], {"tag": "0"})
        self.assertEqual(invalid, [])

    def test_invalid_attempt_is_sealed_and_rerun_once(self) -> None:
        invalid: list[dict] = []
        outcome, problem = run_with_a9({}, {}, "c", self.staging, invalid, 1740, runner=self._runner([False, True]))
        self.assertIsNone(problem)
        self.assertEqual(outcome["observation"], {"tag": "1"})
        self.assertEqual([row["attempt"] for row in invalid], [1])
        self.assertTrue((self.staging / "invalid" / "c__attempt1" / "x").is_file())

    def test_second_invalid_attempt_is_harness_failure(self) -> None:
        invalid: list[dict] = []
        outcome, problem = run_with_a9({}, {}, "c", self.staging, invalid, 1740, runner=self._runner([False, False]))
        self.assertIsNone(outcome)
        self.assertIn("harness failure", problem)
        self.assertEqual(len(invalid), 2)

    def test_more_than_one_percent_invalid_stops(self) -> None:
        invalid = [{"cell": f"old{index}", "attempt": 1} for index in range(17)]
        outcome, problem = run_with_a9({}, {}, "c", self.staging, invalid, 1740, runner=self._runner([False, True]))
        self.assertIsNone(outcome)
        self.assertIn("1%", problem)


if __name__ == "__main__":
    unittest.main()
