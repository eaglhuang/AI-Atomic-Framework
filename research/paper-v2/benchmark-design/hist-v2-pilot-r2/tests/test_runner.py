"""Pilot-r2 runner guards. It does not start the 1740-cell matrix."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT
while REPO != REPO.parent and not (REPO / "atm.mjs").is_file():
    REPO = REPO.parent
sys.path.insert(0, str(ROOT / "src"))

from hist_v2_pilot_r2.runner import (  # noqa: E402
    BINDING_SCHEMA,
    binding_path,
    fixture_from_binding,
    guard_stage,
    load_pilot_items,
)


class PilotR2GuardTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
