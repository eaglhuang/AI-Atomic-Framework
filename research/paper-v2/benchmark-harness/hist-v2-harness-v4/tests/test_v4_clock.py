"""Harness v4: shared monotonic T_stop (prereg v2.1 A8) and the clock-
discontinuity validity rule (A9). No model calls; the multiprocess cases are
a mock-agent dry run on the catalog fixtures."""

import tempfile
import unittest
from pathlib import Path

from hist_v2_classify_v8.score import reconcile_terminal

from hist_v2_harness_v4.catalog import fixture_by_id, load_catalog
from hist_v2_harness_v4.clock import ManualClock
from hist_v2_harness_v4.deadline import effective_stop, timeout_reason
from hist_v2_harness_v4.driver import inprocess_file_lock, inprocess_textual, release_workspace, run_fixture
from hist_v2_harness_v4.itemclock import ItemClock, item_stop_from_first_submits
from hist_v2_harness_v4.limits import COMPARISON_ARMS
from hist_v2_harness_v4.scoring import score_fixture_run, stop_agreement
from hist_v2_harness_v4.validity import INVALID_LABEL, cell_validity, stage_should_stop
from hist_v2_harness_v4.workspace import read_text


def _scorer(first, item_stop, rename=None):
    return reconcile_terminal(
        {
            "send_time": first,
            "first_submit_time": first,
            "item_stop_time": item_stop,
            "entry_points_stopped": True,
            "live_entry_points": [],
            "rename_time": rename,
            "ack_time": rename,
        }
    )


class SharedStopTests(unittest.TestCase):
    def test_effective_stop_is_the_scorer_function(self) -> None:
        for first, others in ((100.0, []), (131.0, [100.0]), (100.0, [100.5]), (120.0, [100.0, 110.0])):
            stop = item_stop_from_first_submits([first, *others])
            self.assertEqual(effective_stop(first, stop), _scorer(first, stop)["effective_stop"])
            self.assertEqual(timeout_reason(first, stop), _scorer(first, stop)["stop_reason"])
        self.assertEqual(timeout_reason(131.0, 130.0), "item-stop")
        self.assertEqual(timeout_reason(100.0, 130.0), "own-deadline")

    def _late_writer(self, runner, arm_proposal_index: int) -> None:
        fixture = fixture_by_id("disjoint")
        proposal = fixture["proposals"][arm_proposal_index]
        workspace = Path(tempfile.mkdtemp(prefix="hist-v2-v4-late-"))
        try:
            ItemClock(workspace / "item-clock").publish("earlier", 100.0)
            result = runner(workspace, fixture, proposal, ManualClock(131.0))
            self.assertEqual(result.arm_terminal, "timeout")
            self.assertEqual(result.stop_reason, "item-stop")
            self.assertIsNone(result.rename_at)
            self.assertFalse(result.accepted)
            self.assertEqual(read_text(workspace / fixture["filename"]), fixture["base"])
            self.assertEqual(result.clocks["item_stop"], 130.0)
            self.assertEqual(result.executable_seconds, 0.0)
        finally:
            release_workspace(workspace)

    def test_late_textual_writer_inherits_item_stop(self) -> None:
        self._late_writer(lambda w, f, p, c: inprocess_textual(w, f, p, c), 1)

    def test_late_file_lock_writer_inherits_item_stop(self) -> None:
        self._late_writer(inprocess_file_lock, 1)

    def test_t_stop_published_while_waiting_for_the_lock_blocks_the_rename(self) -> None:
        fixture = fixture_by_id("disjoint")
        proposal = fixture["proposals"][0]
        clock = ManualClock(120.0)
        workspace = Path(tempfile.mkdtemp(prefix="hist-v2-v4-lock-"))
        try:
            ItemClock(workspace / "item-clock").publish("earlier", 100.0)

            def stall(_path):
                clock.advance(11.0)  # monotonic 131 > T_stop 130 < own 150

            result = inprocess_textual(workspace, fixture, proposal, clock, before_lock=stall)
            self.assertEqual((result.arm_terminal, result.stop_reason), ("timeout", "item-stop"))
            self.assertIsNone(result.rename_at)
            self.assertEqual(read_text(workspace / fixture["filename"]), fixture["base"])
        finally:
            release_workspace(workspace)


class ClockJumpTests(unittest.TestCase):
    def test_realtime_step_leaves_verdict_and_sets_invalid_flag(self) -> None:
        fixture = fixture_by_id("disjoint")
        proposal = fixture["proposals"][0]
        outcomes = {}
        for jump in (0.0, 110.0):
            clock = ManualClock(1000.0, wall_start=1_700_000_000.0)
            workspace = Path(tempfile.mkdtemp(prefix="hist-v2-v4-jump-"))
            try:
                def step(_path, clock=clock, jump=jump):
                    clock.advance(0.2)
                    clock.jump_wall(jump)

                result = inprocess_textual(workspace, fixture, proposal, clock, before_lock=step)
                validity = cell_validity([result.as_dict()], [0.0])
                outcomes[jump] = (result.arm_terminal, result.stop_reason, result.accepted, read_text(workspace / fixture["filename"]), validity)
            finally:
                release_workspace(workspace)
        self.assertEqual(outcomes[0.0][:4], outcomes[110.0][:4])
        self.assertEqual(outcomes[0.0][0], "committed")
        self.assertTrue(outcomes[0.0][4]["valid"])
        self.assertFalse(outcomes[110.0][4]["valid"])
        self.assertEqual(outcomes[110.0][4]["label"], INVALID_LABEL)
        self.assertIn("realtime-monotonic-drift", outcomes[110.0][4]["reasons"])
        self.assertGreater(outcomes[110.0][4]["max_realtime_minus_monotonic_s"], 100.0)

    def test_submit_spread_beyond_design_is_invalid(self) -> None:
        results = [
            {"clocks": {"stamps": [{"event": "submit", "mono": 10.0, "wall": 10.0}]}},
            {"clocks": {"stamps": [{"event": "submit", "mono": 12.5, "wall": 12.5}]}},
        ]
        self.assertFalse(cell_validity(results, [0.0, 500.0])["valid"])
        self.assertTrue(cell_validity(results, [0.0, 2000.0])["valid"])

    def test_stage_stop_threshold(self) -> None:
        self.assertFalse(stage_should_stop(17, 1740))
        self.assertTrue(stage_should_stop(18, 1740))

    def test_multiprocess_wall_jump_in_one_writer(self) -> None:
        fixture = fixture_by_id("disjoint")
        for arm in COMPARISON_ARMS:
            with self.subTest(arm=arm):
                clean = run_fixture(fixture, arm, inter_arrival_ms=50, seed=0)
                jumped = run_fixture(fixture, arm, inter_arrival_ms=50, seed=0, test_wall_jump_s={1: 110.0})
                try:
                    self.assertEqual(clean.body, jumped.body)
                    self.assertEqual(clean.accepted_ids, jumped.accepted_ids)
                    self.assertTrue(clean.validity["valid"], clean.validity)
                    self.assertFalse(jumped.validity["valid"])
                    self.assertEqual(jumped.manifest["validity"]["label"], INVALID_LABEL)
                finally:
                    release_workspace(clean.workspace)
                    release_workspace(jumped.workspace)


class MockAgentDryRunTests(unittest.TestCase):
    def test_comparison_arms_share_one_item_stop_and_agree_with_scorer(self) -> None:
        for fixture in load_catalog()["fixtures"]:
            for arm in COMPARISON_ARMS:
                for interval in (0, 500):
                    with self.subTest(fixture=fixture["id"], arm=arm, interval=interval):
                        run = run_fixture(fixture, arm, order="reverse", inter_arrival_ms=interval, seed=1)
                        try:
                            self.assertTrue(run.validity["valid"], run.validity)
                            score_fixture_run(run)
                            self.assertEqual(stop_agreement(run), [])
                            stops = {round(result.clocks["item_stop"], 3) for result in run.results}
                            self.assertEqual(len(stops), 1, stops)
                            for result in run.results:
                                self.assertEqual(result.clocks["clock"], "monotonic")
                                events = [stamp["event"] for stamp in result.clocks["stamps"]]
                                self.assertIn("barrier_exit", events)
                                self.assertIn("submit", events)
                        finally:
                            release_workspace(run.workspace)


if __name__ == "__main__":
    unittest.main()
