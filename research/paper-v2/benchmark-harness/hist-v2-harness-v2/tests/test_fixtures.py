"""Each arm against the prewritten answer key. These are fixture runs, not a benchmark."""

import unittest

from hist_v2_harness_v2.catalog import load_catalog
from hist_v2_harness_v2.driver import release_workspace, run_fixture
from hist_v2_harness_v2.limits import ARMS
from hist_v2_harness_v2.scoring import score_fixture_run, unevaluated_semantic_entry


def _row(fixture: dict, body: str, accepted: list[int]):
    for row in fixture["allowed"]:
        if row["body"] == body and sorted(row["ids"]) == sorted(accepted):
            return row
    return None


class FixtureTests(unittest.TestCase):
    def test_every_arm_matches_the_answer_key(self) -> None:
        self.assertEqual(unevaluated_semantic_entry()["kind"], "semantic-evaluation")
        for fixture in load_catalog()["fixtures"]:
            for arm in ARMS:
                with self.subTest(fixture=fixture["id"], arm=arm):
                    run = run_fixture(fixture, arm, order="forward", inter_arrival_ms=0, seed=0)
                    try:
                        row = _row(fixture, run.body, run.accepted_ids)
                        self.assertIsNotNone(row, f"{arm} {fixture['id']} body={run.body!r} accepted={run.accepted_ids}")
                        if fixture["id"] == "true-conflict":
                            self.assertTrue(row["maximal"])
                        else:
                            self.assertTrue(row["maximal"])
                            self.assertEqual(sorted(run.accepted_ids), sorted(next(item["ids"] for item in fixture["allowed"] if item["maximal"])))
                        reports = score_fixture_run(run)
                        for report in reports:
                            if report["arm_terminal"] == "committed":
                                self.assertTrue(report["counts_as_success"])
                            else:
                                self.assertFalse(report["counts_as_success"])
                        if arm == "atm" and fixture["id"] == "disjoint":
                            sizes = [result.batch_size for result in run.results]
                            self.assertTrue(all(size is not None and size >= 2 for size in sizes))
                        if arm == "file_lock":
                            for result in run.results:
                                for key in ("lock_wait_ms", "lock_hold_ms", "blocked_count", "serialization_delay_ms"):
                                    self.assertIn(key, result.metrics)
                        for key in ("git_head", "dirty", "lockfile_sha256", "node", "os", "seed", "arm", "events", "base_sha256"):
                            self.assertIn(key, run.manifest)
                        self.assertFalse(run.manifest["formal_run"])
                    finally:
                        release_workspace(run.workspace)


if __name__ == "__main__":
    unittest.main()
