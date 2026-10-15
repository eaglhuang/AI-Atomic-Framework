"""Counterexample: a diff against the PR parent is not a tool error on the common base.

Classifier v8 materializes a placeable side with git merge-file(common base,
parent, head). Harness v2 applied the parent→head unified diff onto the common
base and, on context mismatch, recorded terminal error. v3 keeps file_lock on
that historical hunk, and gives the other arms the 3-way mine.
"""

import unittest

from hist_v2_harness_v3.driver import release_workspace, run_fixture
from hist_v2_harness_v3.materialize import failure_terminal, unified_diff
from hist_v2_harness_v3.patchutil import PatchApplyError, apply_unified_patch

BASE = "alpha\nbeta\nmiddle\ngamma\ntail\n"
PARENT = "alpha\nBETA\nmiddle\ngamma\ntail\n"
HEAD = "alpha\nBETA\nmiddle\nGAMMA\ntail\n"
MINE = "alpha\nbeta\nmiddle\nGAMMA\ntail\n"


def _fixture(with_endpoints: bool) -> dict:
    proposal = {
        "id": 11,
        "operation": "edit",
        "unified_diff": unified_diff("shared.txt", PARENT, HEAD),
        "signature": "GAMMA",
    }
    if with_endpoints:
        proposal["parent_text"] = PARENT
        proposal["head_text"] = HEAD
    return {
        "id": "transplant-clean",
        "filename": "shared.txt",
        "base": BASE,
        "base_absent": False,
        "full_reject_allowed": False,
        "proposals": [proposal],
        "allowed": [{"ids": [11], "maximal": True, "body": MINE}],
    }


class ThreeWayMineTests(unittest.TestCase):
    def test_historical_diff_does_not_apply_to_the_common_base(self) -> None:
        diff = _fixture(False)["proposals"][0]["unified_diff"]
        with self.assertRaises(PatchApplyError):
            apply_unified_patch(BASE, diff)
        self.assertEqual(failure_terminal("patch context mismatch at line 2"), "conflict")
        self.assertEqual(failure_terminal("apply-patch produced no output"), "error")

    def test_context_mismatch_without_endpoints_is_rejected_conflict(self) -> None:
        run = run_fixture(_fixture(False), "textual_merge_file", inter_arrival_ms=0, seed=0)
        try:
            self.assertEqual(run.results[0].arm_terminal, "rejected-conflict")
            self.assertNotEqual(run.results[0].arm_terminal, "error")
            self.assertEqual(run.body, BASE)
            self.assertEqual(run.accepted_ids, [])
        finally:
            release_workspace(run.workspace)

    def test_three_way_mine_commits_for_textual_and_steward_only(self) -> None:
        fixture = _fixture(True)
        textual = run_fixture(fixture, "textual_merge_file", inter_arrival_ms=0, seed=0)
        steward = run_fixture(fixture, "steward", inter_arrival_ms=0, seed=1)
        locked = run_fixture(fixture, "file_lock", inter_arrival_ms=0, seed=0)
        try:
            self.assertEqual(textual.body, MINE)
            self.assertEqual(textual.results[0].arm_terminal, "committed")
            self.assertEqual(textual.accepted_ids, [11])
            self.assertEqual(steward.body, MINE)
            self.assertEqual(steward.results[0].arm_terminal, "committed")
            self.assertEqual(steward.accepted_ids, [11])
            self.assertEqual(locked.results[0].arm_terminal, "rejected-conflict")
            self.assertEqual(locked.body, BASE)
            self.assertEqual(locked.accepted_ids, [])
        finally:
            release_workspace(textual.workspace)
            release_workspace(steward.workspace)
            release_workspace(locked.workspace)


if __name__ == "__main__":
    unittest.main()
