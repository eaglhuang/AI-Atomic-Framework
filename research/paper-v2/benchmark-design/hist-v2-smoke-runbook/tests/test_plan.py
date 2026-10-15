"""The smoke plan is a reduced matrix and does not start a run."""

import unittest
from pathlib import Path

from hist_v2_smoke_runbook.pins import load_pins
from hist_v2_smoke_runbook.plan import build_plan
from hist_v2_smoke_runbook.sample import load_items, sample_dev
from hist_v2_smoke_runbook.stage import pilot_overlay

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "dev-items.jsonl"


class PlanTests(unittest.TestCase):
    def test_reduced_sweep_covers_every_arm(self) -> None:
        items, _errors = load_items(FIXTURE)
        pins = load_pins()
        sample = sample_dev(items, pins)
        plan = build_plan(sample["selected"], pins)
        self.assertFalse(plan["executed"])
        self.assertEqual(plan["runs_started"], 0)
        self.assertFalse(plan["claims_benchmark_wins"])
        self.assertEqual(plan["seeds"], [0])
        self.assertEqual(plan["orders"], ["forward", "reverse"])
        self.assertEqual(plan["inter_arrival_ms"], [0, 500])
        self.assertEqual(plan["cell_count"], 6 * 1 * 2 * 2 * 4)
        self.assertEqual(plan["per_item_cell_count"], 16)
        arms = {cell["arm"] for cell in plan["cells"]}
        self.assertEqual(arms, set(pins["arms"]))
        intervals = {cell["inter_arrival_ms"] for cell in plan["cells"]}
        self.assertEqual(intervals, {0, 500})
        self.assertTrue(all(cell["executed"] is False for cell in plan["cells"]))

    def test_pilot_matrix_is_the_frozen_three_arm_grid(self) -> None:
        items, _errors = load_items(FIXTURE)
        for item in items:
            item["prs"] = [1, 2]
        overlay, problems = pilot_overlay(load_pins())
        self.assertEqual(problems, [])
        sample = sample_dev(items, overlay)
        plan = build_plan(sample["selected"], overlay)
        self.assertEqual(plan["arms"], ["steward", "file_lock", "textual_merge_file"])
        self.assertEqual(plan["per_item_cell_count"], 2 * 2 * 5 * 3)
        self.assertNotIn("atm", {cell["arm"] for cell in plan["cells"]})
        first = []
        for item in sample["selected"]:
            for seed in plan["seeds"]:
                rank0 = [
                    cell["arm"]
                    for cell in plan["cells"]
                    if cell["item_id"] == item["id"] and cell["seed"] == seed and cell["arm_rank"] == 0
                ]
                self.assertEqual(len(set(rank0)), 1)
                first.append(rank0[0])
        self.assertIn("steward", first)
        self.assertGreater(len(set(first)), 1)

    def test_plan_module_does_not_import_the_harness_runner(self) -> None:
        import hist_v2_smoke_runbook.plan as plan_module

        self.assertFalse(hasattr(plan_module, "run_fixture"))


if __name__ == "__main__":
    unittest.main()
