"""The smoke plan is a reduced matrix and does not start a run."""

import unittest
from pathlib import Path

from hist_v2_smoke_runbook.pins import load_pins
from hist_v2_smoke_runbook.plan import build_plan
from hist_v2_smoke_runbook.sample import load_items, sample_dev

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

    def test_plan_module_does_not_import_the_harness_runner(self) -> None:
        import hist_v2_smoke_runbook.plan as plan_module

        self.assertFalse(hasattr(plan_module, "run_fixture"))


if __name__ == "__main__":
    unittest.main()
