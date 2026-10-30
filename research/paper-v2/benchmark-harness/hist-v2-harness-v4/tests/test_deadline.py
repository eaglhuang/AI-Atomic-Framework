"""Injected clock. No 30 second sleep."""

import unittest

from hist_v2_classify_v8.score import DEADLINE_SECONDS, MAX_RETRIES_AFTER_FIRST_SUBMIT, reconcile_terminal

from hist_v2_harness_v4.atomic import atomic_replace
from hist_v2_harness_v4.clock import ManualClock
from hist_v2_harness_v4.deadline import AttemptBudget
from hist_v2_harness_v4.limits import DEADLINE_SECONDS as HARNESS_DEADLINE
from hist_v2_harness_v4.limits import MAX_ATTEMPTS, MAX_RETRIES_AFTER_FIRST_SUBMIT as HARNESS_RETRIES


class DeadlineTests(unittest.TestCase):
    def test_limits_match_the_frozen_classifier(self) -> None:
        self.assertEqual(HARNESS_DEADLINE, 30)
        self.assertEqual(HARNESS_RETRIES, 8)
        self.assertEqual(MAX_ATTEMPTS, 9)
        self.assertEqual(DEADLINE_SECONDS, HARNESS_DEADLINE)
        self.assertEqual(MAX_RETRIES_AFTER_FIRST_SUBMIT, HARNESS_RETRIES)

    def test_retry_does_not_reset_the_30_second_clock(self) -> None:
        clock = ManualClock(0)
        budget = AttemptBudget()
        budget.open_first(clock.now())
        clock.advance(5)
        self.assertTrue(budget.consume_retry(clock.now(), 30))
        self.assertEqual(budget.first_submit, 0)
        self.assertEqual(budget.effective_stop(30), 30)
        self.assertEqual(budget.executable_seconds(30), 30)
        clock.advance(26)
        self.assertTrue(budget.expired(clock.now(), 30))
        self.assertFalse(budget.consume_retry(clock.now(), 30))

    def test_late_submit_keeps_28_executable_seconds(self) -> None:
        budget = AttemptBudget()
        budget.open_first(2)
        self.assertEqual(budget.executable_seconds(30), 28)

    def test_ninth_attempt_is_the_last(self) -> None:
        budget = AttemptBudget()
        budget.open_first(0)
        for _ in range(8):
            self.assertTrue(budget.consume_retry(0, 30))
        self.assertEqual(budget.attempts, 9)
        self.assertEqual(budget.retries, 8)
        self.assertFalse(budget.consume_retry(0, 30))
        self.assertEqual(budget.attempts, 9)

    def test_three_timeout_terminals(self) -> None:
        base = {
            "send_time": 0.0,
            "first_submit_time": 0.0,
            "item_stop_time": 30.0,
            "entry_points_stopped": True,
            "live_entry_points": [],
        }
        durable = reconcile_terminal({**base, "rename_time": 1.0, "ack_time": None})
        self.assertEqual(durable["terminal"], "durable-unacked")
        self.assertEqual(durable["stop_reason"], "ack-missing")
        self.assertFalse(durable["in_throughput"])
        late = reconcile_terminal({**base, "rename_time": 31.0, "ack_time": 31.0})
        self.assertEqual(late["terminal"], "late-commit-after-timeout")
        self.assertEqual(late["stop_reason"], "rename-after-stop")
        incomplete = reconcile_terminal({**base, "entry_points_stopped": False, "live_entry_points": ["writer-2"], "rename_time": 1.0, "ack_time": 1.0})
        self.assertEqual(incomplete["terminal"], "reconciliation-incomplete")
        self.assertFalse(incomplete["final"])

    def test_commit_gate_does_not_rename_after_the_stop(self) -> None:
        import tempfile
        from pathlib import Path

        clock = ManualClock(0)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "shared.txt"
            path.write_text("before\n", encoding="utf-8")
            renamed = atomic_replace(path, b"after\n", clock, effective_stop=-1)
            self.assertIsNone(renamed)
            self.assertEqual(path.read_text(encoding="utf-8"), "before\n")
            self.assertFalse(any(name.name.startswith(".shared.txt.tmp-harness-") for name in Path(temp).iterdir()))


if __name__ == "__main__":
    unittest.main()
