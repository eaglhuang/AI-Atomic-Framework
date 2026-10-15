"""Five injected controls. A clean disjoint fixture is combined_success without them."""

import unittest

from hist_v2_classify_v8.score import proposal_final_report, score_run

from hist_v2_harness_v3.catalog import fixture_by_id
from hist_v2_harness_v3.digest import sha256_text
from hist_v2_harness_v3.negative import CONTROLS, inject
from hist_v2_harness_v3.scoring import acceptance_entry, answer_from_fixture, semantic_entry, validate_semantic_input


class NegativeControlTests(unittest.TestCase):
    def test_each_control_is_caught_and_labeled_as_an_injection(self) -> None:
        seen = []
        for control in CONTROLS:
            caught = inject(control)
            self.assertTrue(caught["injected"])
            self.assertEqual(caught["control"], control)
            seen.append(control)
            if control == "late-write-after-timeout":
                self.assertEqual(caught["terminal"]["terminal"], "late-commit-after-timeout")
                self.assertFalse(caught["combined"]["counts_as_success"])
                self.assertFalse(caught["report"]["counts_as_success"])
            elif control == "illegal-subset":
                self.assertEqual(caught["report"]["acceptance"]["safety_reason"], "illegal-set")
                self.assertFalse(caught["report"]["counts_as_success"])
            elif control == "lost-accepted-proposal":
                self.assertEqual(caught["report"]["acceptance"]["safety_reason"], "bytes-do-not-match-R(S)")
                self.assertEqual(caught["lost_effect_ids"], [2])
                self.assertFalse(caught["report"]["counts_as_success"])
            elif control == "partial-apply":
                self.assertTrue(caught["partial"])
                self.assertEqual(caught["report"]["acceptance"]["safety_reason"], "bytes-do-not-match-R(S)")
                self.assertFalse(caught["report"]["counts_as_success"])
            else:
                self.assertEqual(caught["report"]["acceptance"]["safety_reason"], "bytes-do-not-match-R(S)")
                self.assertNotIn(caught["body_sha256"], {sha256_text(row["body"]) for row in fixture_by_id("disjoint")["allowed"]})
        self.assertEqual(seen, list(CONTROLS))

    def test_clean_answer_key_is_combined_success(self) -> None:
        fixture = fixture_by_id("disjoint")
        maximal = next(row for row in fixture["allowed"] if row["maximal"])
        answer = answer_from_fixture(fixture)
        acceptance = acceptance_entry(maximal["ids"], maximal["body"], True)
        event = {
            "send_time": 0.0,
            "first_submit_time": 0.0,
            "item_stop_time": 30.0,
            "entry_points_stopped": True,
            "live_entry_points": [],
            "rename_time": 1.0,
            "ack_time": 1.0,
        }
        report = proposal_final_report(event, answer, acceptance)
        self.assertTrue(report["counts_as_success"])
        self.assertEqual(report["status"], "success")

    def test_non_maximal_is_safe_and_short_on_progress(self) -> None:
        fixture = fixture_by_id("disjoint")
        row = next(item for item in fixture["allowed"] if item["ids"] == [1])
        scored = score_run(answer_from_fixture(fixture), acceptance_entry([1], row["body"], True))
        self.assertEqual(scored["safety"], "pass")
        self.assertEqual(scored["progress"], "shortfall")

    def test_unnecessary_reject_is_not_a_safety_failure(self) -> None:
        fixture = fixture_by_id("disjoint")
        scored = score_run(answer_from_fixture(fixture), acceptance_entry([], fixture["base"], False))
        self.assertEqual(scored["safety"], "pass")
        self.assertEqual(scored["safety_reason"], "no-false-accept")
        self.assertEqual(scored["progress_reason"], "unnecessary-reject")

    def test_acceptance_and_semantic_entries_stay_separate(self) -> None:
        semantic = semantic_entry(["t1"], ["t1"], 1, 1, False)
        self.assertEqual(semantic["kind"], "semantic-evaluation")
        mixed = {
            "kind": "acceptance",
            "accepted_prs": [1],
            "observed_sha256": "abc",
            "acked": True,
            "retained_pass_count": 2,
            "reference_pass_count": 1,
        }
        with self.assertRaises(Exception):
            acceptance_entry_raw(mixed)
        with self.assertRaises(Exception):
            validate_semantic_input(mixed)


def acceptance_entry_raw(payload: dict):
    from hist_v2_classify_v8.score import validate_acceptance_input

    return validate_acceptance_input(payload)


if __name__ == "__main__":
    unittest.main()
