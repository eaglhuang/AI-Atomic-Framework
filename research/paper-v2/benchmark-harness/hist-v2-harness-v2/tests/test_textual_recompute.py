"""textual_merge_file discards a stale outside candidate and counts the recompute."""

import tempfile
import unittest
from pathlib import Path

from hist_v2_harness_v2.catalog import build_patch, fixture_by_id
from hist_v2_harness_v2.clock import ManualClock
from hist_v2_harness_v2.driver import inprocess_textual, release_workspace
from hist_v2_harness_v2.workspace import read_text


class TextualRecomputeTests(unittest.TestCase):
    def test_base_move_recomputes_and_does_not_commit_the_stale_candidate(self) -> None:
        fixture = fixture_by_id("disjoint")
        proposal = fixture["proposals"][1]
        stale = {}

        def move(path: Path) -> None:
            # Another writer landed proposal 1 before this writer acquired the lock.
            path.write_text("alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\n", encoding="utf-8")
            stale["outside"] = "alpha\nbeta\ngamma\ndelta\nEPSILON\nzeta\n"

        workspace = Path(tempfile.mkdtemp(prefix="hist-v2-textual-"))
        try:
            result = inprocess_textual(workspace, fixture, proposal, ManualClock(0), before_lock=move)
            self.assertEqual(result.retries, 1)
            self.assertEqual(result.attempts, 2)
            self.assertTrue(any(event.get("type") == "discard-stale" for event in result.events))
            self.assertNotEqual(read_text(workspace / fixture["filename"]), stale["outside"])
            self.assertEqual(read_text(workspace / fixture["filename"]), "alpha\nBETA\ngamma\ndelta\nEPSILON\nzeta\n")
            self.assertEqual(result.arm_terminal, "committed")
        finally:
            release_workspace(workspace)

    def test_retry_budget_blocks_the_stale_candidate(self) -> None:
        fixture = fixture_by_id("disjoint")
        proposal = fixture["proposals"][0]
        workspace = Path(tempfile.mkdtemp(prefix="hist-v2-textual-stop-"))
        try:
            result = inprocess_textual(
                workspace,
                fixture,
                proposal,
                ManualClock(0),
                before_lock=lambda path: path.write_text("changed\n", encoding="utf-8"),
                retries_already=8,
            )
            self.assertFalse(result.accepted)
            self.assertIsNone(result.rename_at)
            self.assertEqual(read_text(workspace / fixture["filename"]), "changed\n")
            self.assertTrue(any(event.get("type") == "stale-not-committed" for event in result.events))
            self.assertNotEqual(read_text(workspace / fixture["filename"]), build_patch(fixture, proposal))
        finally:
            release_workspace(workspace)


if __name__ == "__main__":
    unittest.main()
