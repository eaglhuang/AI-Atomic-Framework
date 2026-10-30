"""The matrix planner returns cells and does not start a run."""

import unittest

from hist_v2_harness_v4.limits import ARMS, COMPARISON_ARMS, INTER_ARRIVAL_MS, ORDERS, SEEDS
from hist_v2_harness_v4.plan import build_plan


class PlanTests(unittest.TestCase):
    def test_sweep_and_both_orders_are_planned_only(self) -> None:
        plan = build_plan(["disjoint"])
        self.assertFalse(plan["executed"])
        self.assertEqual(plan["runs_started"], 0)
        self.assertEqual(tuple(plan["inter_arrival_ms"]), INTER_ARRIVAL_MS)
        self.assertEqual(tuple(plan["orders"]), ORDERS)
        self.assertEqual(tuple(plan["seeds"]), SEEDS)
        self.assertEqual(tuple(plan["arms"]), ARMS)
        self.assertEqual(plan["per_fixture_cell_count"], 2 * 2 * 5 * 4)
        self.assertEqual(plan["per_fixture_comparison_cell_count"], 2 * 2 * 5 * 3)
        self.assertEqual(len(COMPARISON_ARMS), 3)
        firsts = {cell["arm"] for cell in plan["cells"] if cell["arm_rank"] == 0}
        self.assertGreater(len(firsts), 1)

    def test_plan_has_no_execution_hook(self) -> None:
        import hist_v2_harness_v4.plan as plan_module

        self.assertFalse(hasattr(plan_module, "run_fixture"))


if __name__ == "__main__":
    unittest.main()
