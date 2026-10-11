"""Pure decision, distance, semantic, and grouping tests. No network."""

from __future__ import annotations

import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from hist_v2_classify_v5.classify import SideView, decide  # noqa: E402
from hist_v2_classify_v5.score import (  # noqa: E402
    ScoreInputError,
    bootstrap_interval,
    delivery_rows,
    equal_weight_pool,
    legal_set_key,
    proposal_final_report,
    reconcile_terminal,
    resample_final_report,
    score_run,
    semantic_status,
    textual_merge_file_on_lock,
    validate_score_instance,
    zero_event_component_bound,
)
from hist_v2_classify_v5.gitio import ALLOWED_GIT  # noqa: E402
from hist_v2_classify_v5.hunks import dist, stratum_for  # noqa: E402
from hist_v2_classify_v5.labels import (  # noqa: E402
    apply_holdout_leakage,
    assign_clusters,
    assign_ids,
    infer_set,
    semantic_assessment,
)
from hist_v2_classify_v5.parameters import ADJACENT_MAX_DISTANCE  # noqa: E402
from hist_v2_classify_v5.pipeline import parse_candidate  # noqa: E402


def _sha(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def side(**kwargs) -> SideView:
    payload = dict(
        mb="mb",
        head="head",
        selected_mb="mb",
        selected_head="head",
        patch_source="final-head",
        op="modify",
        merged_at="2024-01-02T00:00:00Z",
        after=b"x\n",
        hunks=[{"start": 0, "end": 1, "kind": "replace"}],
        gold_test_ids=["tests.test_mod"],
        base_validity="pass",
        transplant_conflict=False,
        code_patch_sha256="0" * 64,
        notes=[],
    )
    payload.update(kwargs)
    return SideView(**payload)


class DistanceTests(unittest.TestCase):
    def test_v1_distance_cases(self):
        self.assertEqual(ADJACENT_MAX_DISTANCE, 3)
        self.assertEqual(dist({"start": 0, "end": 2}, {"start": 1, "end": 3}), 0)
        self.assertEqual(dist({"start": 0, "end": 2}, {"start": 2, "end": 4}), 0)
        self.assertEqual(dist({"start": 5, "end": 5}, {"start": 5, "end": 5}), 0)
        self.assertEqual(dist({"start": 0, "end": 1}, {"start": 4, "end": 5}), 3)
        self.assertEqual(dist({"start": 0, "end": 1}, {"start": 5, "end": 6}), 4)
        self.assertEqual(stratum_for(0), "O1")
        self.assertEqual(stratum_for(3), "O2")
        self.assertEqual(stratum_for(4), "O3")
        self.assertEqual(stratum_for(None), "O3")

    def test_rules_mention_the_threshold(self):
        text = (ROOT / "RULES.md").read_text(encoding="utf-8")
        self.assertIn("距離 > 3", text)
        self.assertIn("min_dist ≤ 3", text)
        self.assertNotIn("src-lines", text)


class DecisionTests(unittest.TestCase):
    def test_order_dependent_layer_is_not_class_a(self):
        def merger(current, _base, other):
            return 0, current + b"|" + other

        decision = decide(
            b"base\n",
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", after=b"A\n", hunks=[{"start": 0, "end": 1, "kind": "replace"}]),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", after=b"B\n", hunks=[{"start": 20, "end": 21, "kind": "replace"}]),
            ],
            merger,
        )
        self.assertEqual(decision.write_class, "B'")
        self.assertEqual(decision.test_purpose_code, "order-dependent-merge")
        self.assertIsNone(decision.correct_answer["expected_sha256"])
        self.assertEqual(len(decision.correct_answer["orders"]), 2)
        allowed = {tuple(row["prs"]): row["maximal"] for row in decision.correct_answer["allowed"]}
        self.assertEqual(set(allowed), {(1,), (2,)})
        self.assertTrue(all(allowed.values()))
        self.assertNotIn((1, 2), allowed)

    def test_structural_short_circuit_does_not_merge(self):
        def merger(*_args):
            raise AssertionError("class D must not call merge-file")

        decision = decide(
            b"base\n",
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", op="create", after=None, hunks=[]),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", op="modify"),
            ],
            merger,
        )
        self.assertEqual(decision.write_class, "D")
        self.assertEqual(decision.correct_answer["kind"], "write-safety-fail-closed")
        self.assertEqual(decision.blobs, {})

    def test_conflict_allowed_set_is_one_sided(self):
        def merger(*_args):
            return 1, b"<<<<<<< cur\n=======\n>>>>>>> other\n"

        left = b"left\n"
        right = b"right\n"
        decision = decide(
            b"base\n",
            [
                side(pr=2, committer_time="2024-01-02T00:00:00Z", after=right),
                side(pr=1, committer_time="2024-01-01T00:00:00Z", after=left),
            ],
            merger,
        )
        self.assertEqual(decision.write_class, "C")
        self.assertEqual(decision.outcome, "true-conflict")
        allowed = {tuple(row["prs"]) for row in decision.correct_answer["allowed"]}
        self.assertEqual(allowed, {(1,), (2,)})
        self.assertFalse(decision.correct_answer["full_reject_allowed"])
        self.assertIn("文字合併標準", decision.correct_answer["textual_merge_standard_note_zh"])
        self.assertNotIn(b"<<<<<<<", b"".join(decision.blobs.values()))

    def test_tool_error_is_not_class_c(self):
        def merger(*_args):
            return 128, b""

        decision = decide(
            b"base\n",
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", after=b"A\n"),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", after=b"B\n"),
            ],
            merger,
        )
        self.assertIsNone(decision.write_class)
        self.assertNotEqual(decision.write_class, "C")
        self.assertEqual(decision.outcome, "tool-execution-error")

    def test_maximal_legal_subsets_for_three_proposals(self):
        def merger(current, _base, other):
            left = set(current.split())
            right = set(other.split())
            if b"L" in left and b"R" in right or b"R" in left and b"L" in right:
                return 1, b"<<<<<<<\n"
            return 0, b" ".join(sorted(left | right))

        decision = decide(
            b"BASE",
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", after=b"L", hunks=[{"start": 0, "end": 1, "kind": "replace"}]),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", after=b"R", hunks=[{"start": 0, "end": 1, "kind": "replace"}]),
                side(pr=3, committer_time="2024-01-03T00:00:00Z", after=b"Z", hunks=[{"start": 10, "end": 11, "kind": "replace"}]),
            ],
            merger,
        )
        self.assertEqual(decision.write_class, "C")
        allowed = {tuple(row["prs"]): row for row in decision.correct_answer["allowed"]}
        self.assertEqual(set(allowed), {(1,), (2,), (3,), (1, 3), (2, 3)})
        self.assertNotIn((1, 2), allowed)
        self.assertTrue(allowed[(1, 3)]["maximal"])
        self.assertTrue(allowed[(2, 3)]["maximal"])
        self.assertFalse(allowed[(1,)]["maximal"])
        self.assertFalse(allowed[(3,)]["maximal"])
        self.assertEqual(allowed[(1,)]["sha256"], _sha(b"L"))
        self.assertEqual(decision.blobs["subset-1"], b"L")
        self.assertFalse(decision.correct_answer["full_reject_allowed"])

    def test_transplant_conflict_is_not_class_c(self):
        def merger(*_args):
            raise AssertionError("a solo transplant failure is not a concurrency merge")

        decision = decide(
            b"base\n",
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", after=None, transplant_conflict=True, hunks=[]),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", after=b"ok\n"),
            ],
            merger,
        )
        self.assertIsNone(decision.write_class)
        self.assertEqual(decision.outcome, "transplant-conflict")
        self.assertIn("transplant-conflict", decision.labels)
        self.assertEqual({tuple(row["prs"]) for row in decision.correct_answer["allowed"]}, {(2,)})
        self.assertFalse(decision.correct_answer["full_reject_allowed"])

    def test_full_reject_only_when_no_legal_subset(self):
        decision = decide(
            b"base\n",
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", after=None, transplant_conflict=True, hunks=[]),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", after=None, transplant_conflict=True, hunks=[]),
            ],
            lambda *_args: (0, b"unused"),
        )
        self.assertIsNone(decision.write_class)
        self.assertTrue(decision.correct_answer["full_reject_allowed"])
        self.assertEqual(decision.correct_answer["allowed"], [])

    def test_class_b_is_not_relabelled_c(self):
        def merger(current, _base, other):
            return 0, b" ".join(sorted(set(current.split()) | set(other.split())))

        decision = decide(
            b"base",
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", after=b"A", hunks=[{"start": 0, "end": 1, "kind": "replace"}]),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", after=b"B", hunks=[{"start": 2, "end": 3, "kind": "replace"}]),
            ],
            merger,
        )
        self.assertEqual(decision.write_class, "B")
        self.assertEqual(decision.outcome, "mergeable")
        self.assertTrue(decision.correct_answer["scoring"]["b_rejected_by_atm_is_progress_not_class_c"])

    def test_patch_equivalence_leak_is_transitive_with_shared_prs(self):
        def row(prs, set_name, patch):
            return {
                "project": "p",
                "set": set_name,
                "prs": prs,
                "target_file": "a.py",
                "grouping_codes": [],
                "patches": [patch],
            }

        dev = row([1], "dev", {"pr": 1, "has_patch_bytes": True, "code_patch_sha256": "aaa", "patch_id": "p1", "commit_subject": "fix"})
        later = row(
            [9],
            "later-period-historical-holdout",
            {"pr": 9, "has_patch_bytes": True, "code_patch_sha256": "bbb", "patch_id": "p1", "commit_subject": "backport: fix"},
        )
        untouched = row(
            [4],
            "later-period-historical-holdout",
            {"pr": 4, "has_patch_bytes": True, "code_patch_sha256": "ccc", "patch_id": "p9", "commit_subject": "other"},
        )
        items = [dev, later, untouched]
        apply_holdout_leakage(items)
        assign_ids(items)
        assign_clusters(items)
        self.assertEqual(later["set"], "dev-cross-window")
        self.assertIn("backport-leak", later["grouping_codes"])
        self.assertEqual(dev["cluster_id"], later["cluster_id"])
        self.assertNotEqual(dev["cluster_id"], untouched["cluster_id"])
        self.assertEqual(untouched["set"], "later-period-historical-holdout")


class SemanticAndGroupingTests(unittest.TestCase):
    def test_semantic_matrix(self):
        flag, reasons = semantic_assessment(
            [side(pr=1, committer_time="2024-01-01T00:00:00Z"), side(pr=2, committer_time="2024-01-02T00:00:00Z")]
        )
        self.assertEqual((flag, reasons), ("S", []))
        flag, reasons = semantic_assessment(
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", patch_source="rebase-before-head"),
                side(pr=2, committer_time="2024-01-02T00:00:00Z"),
            ]
        )
        self.assertEqual(flag, "N")
        self.assertIn("rebase-before-head", reasons)
        flag, reasons = semantic_assessment(
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", base_validity="unbuildable"),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", base_validity="unbuildable"),
            ]
        )
        self.assertEqual(flag, "N")
        self.assertIn("base-env-unbuildable", reasons)
        flag, reasons = semantic_assessment(
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", gold_test_ids=[], base_validity=None),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", gold_test_ids=[], base_validity=None),
            ]
        )
        self.assertIn("no-gold", reasons)
        self.assertIn("base-validity-not-provided", reasons)

    def test_windows_and_shared_pr_grouping(self):
        self.assertEqual(infer_set(["2024-01-01T00:00:00Z", "2025-12-31T23:00:00Z"], None), "dev")
        self.assertEqual(infer_set(["2026-01-01T00:00:00Z", "2026-09-30T00:00:00Z"], None), "later-period-historical-holdout")
        self.assertEqual(infer_set(["2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"], None), "cross-window")
        self.assertEqual(infer_set(["2024-06-01T00:00:00Z", "2026-06-01T00:00:00Z"], None), "cross-window")
        self.assertEqual(infer_set(["2026-06-01T00:00:00Z"], "held-out-project"), "held-out-project")
        self.assertEqual(infer_set([], "held-out"), "later-period-historical-holdout")
        items = [
            {"project": "p", "set": "dev", "prs": [1, 2], "target_file": "a.py", "grouping_codes": []},
            {"project": "p", "set": "cross-window", "prs": [2, 3], "target_file": "b.py", "grouping_codes": []},
            {"project": "p", "set": "later-period-historical-holdout", "prs": [3, 4], "target_file": "c.py", "grouping_codes": []},
            {"project": "p", "set": "later-period-historical-holdout", "prs": [8, 9], "target_file": "d.py", "grouping_codes": []},
        ]
        apply_holdout_leakage(items)
        self.assertEqual(items[1]["set"], "dev-cross-window")
        self.assertEqual(items[1]["grouping_codes"], ["shared-pr-component-leak"])
        self.assertEqual(items[2]["set"], "dev-cross-window")
        self.assertEqual(items[2]["grouping_codes"], ["shared-pr-component-leak"])
        self.assertEqual(items[3]["set"], "later-period-historical-holdout")
        self.assertEqual(items[3]["grouping_codes"], [])
        assign_ids(items)
        assign_clusters(items)
        self.assertEqual(items[0]["cluster_id"], items[1]["cluster_id"])
        self.assertEqual(items[1]["cluster_id"], items[2]["cluster_id"])
        self.assertNotEqual(items[0]["cluster_id"], items[3]["cluster_id"])

    def test_v1_writer_rows_declare_pre_rebase(self):
        candidate = parse_candidate(
            {
                "project": "django",
                "target_file": "pkg/a.py",
                "writers": [
                    {"pr": 1, "mb": "a" * 40, "head": "b" * 40, "writer_version": "pre-rebase"},
                    {"pr": 2, "mb": "c" * 40, "head": "d" * 40, "writer_version": "final"},
                ],
            },
            0,
        )
        self.assertEqual(candidate.patches[0].declared_source, "rebase-before-head")
        self.assertIsNone(candidate.patches[1].declared_source)

    def test_tool_does_not_grow_an_arm_runner(self):
        source = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "src").rglob("*.py"))
        for banned in ("oracle_rows", "bare_composer", "result.json", "benchmark-main"):
            self.assertNotIn(banned, source)
        self.assertNotIn("checkout", ALLOWED_GIT)
        self.assertNotIn("commit", ALLOWED_GIT)
        self.assertNotIn("reset", ALLOWED_GIT)
        self.assertNotIn("stash", ALLOWED_GIT)


class ScoreContractTests(unittest.TestCase):
    def _three(self):
        def merger(current, _base, other):
            left = set(current.split())
            right = set(other.split())
            if (b"L" in left and b"R" in right) or (b"R" in left and b"L" in right):
                return 1, b"<<<<<<<\n"
            return 0, b" ".join(sorted(left | right))

        return decide(
            b"BASE",
            [
                side(pr=1, committer_time="2024-01-01T00:00:00Z", after=b"L", hunks=[{"start": 0, "end": 1, "kind": "replace"}]),
                side(pr=2, committer_time="2024-01-02T00:00:00Z", after=b"R", hunks=[{"start": 0, "end": 1, "kind": "replace"}]),
                side(pr=3, committer_time="2024-01-03T00:00:00Z", after=b"Z", hunks=[{"start": 10, "end": 11, "kind": "replace"}]),
            ],
            merger,
        )

    def test_legal_non_maximal_is_safe_but_a_progress_shortfall(self):
        answer = self._three().correct_answer
        singleton = next(row for row in answer["allowed"] if row["prs"] == [1])
        scored = score_run(
            answer,
            {"accepted_prs": [1], "observed_sha256": singleton["sha256"], "acked": True},
        )
        self.assertEqual(scored["safety"], "pass")
        self.assertEqual(scored["safety_reason"], "legal-and-matches-R(S)")
        self.assertEqual(scored["progress"], "shortfall")
        self.assertEqual(scored["progress_reason"], "legal-non-maximal")
        self.assertFalse(scored["maximal"])

    def test_maximal_accept_passes_safety_and_progress(self):
        answer = self._three().correct_answer
        chosen = next(row for row in answer["allowed"] if row["prs"] == [1, 3])
        scored = score_run(
            answer,
            {"accepted_prs": [3, 1], "observed_sha256": chosen["sha256"], "acked": True},
        )
        self.assertEqual((scored["safety"], scored["progress"]), ("pass", "maximal"))
        self.assertEqual(scored["accepted_prs"], [1, 3])

    def test_illegal_pair_and_byte_mismatch_are_safety_failures(self):
        answer = self._three().correct_answer
        illegal = score_run(
            answer,
            {"accepted_prs": [1, 2], "observed_sha256": _sha(b"L R"), "acked": True},
        )
        self.assertEqual(illegal["safety"], "fail")
        self.assertEqual(illegal["safety_reason"], "illegal-set")
        self.assertEqual(illegal["progress"], "not-applicable")
        mismatched = score_run(
            answer,
            {"accepted_prs": [1], "observed_sha256": _sha(b"nope"), "acked": True},
        )
        self.assertEqual(mismatched["safety_reason"], "bytes-do-not-match-R(S)")

    def test_unnecessary_reject_is_progress_not_safety(self):
        answer = self._three().correct_answer
        scored = score_run(
            answer,
            {"accepted_prs": [], "observed_sha256": answer["unchanged_base_sha256"], "acked": False},
        )
        self.assertEqual(scored["safety"], "pass")
        self.assertEqual(scored["progress_reason"], "unnecessary-reject")
        false_ack = score_run(
            answer,
            {"accepted_prs": [], "observed_sha256": answer["unchanged_base_sha256"], "acked": True},
        )
        self.assertEqual(false_ack["safety_reason"], "false-ack")

    def test_delivery_rows_separate_rates_rejects_and_zero_denominators(self):
        rows = delivery_rows(
            [
                {"has_tests": True, "delivered": True, "legally_rejected": False},
                {"has_tests": True, "delivered": False, "legally_rejected": True},
                {"has_tests": False, "delivered": False, "legally_rejected": False},
            ],
            [
                {
                    "passing_test_ids": ["t1", "t2", "t3", "t4"],
                    "retained_test_ids": ["t1", "t2", "t3"],
                    "reference_pass_count": 4,
                    "retained_pass_count": 3,
                    "is_legal_reject": False,
                },
                {
                    "passing_test_ids": ["t1", "t2"],
                    "retained_test_ids": [],
                    "reference_pass_count": 2,
                    "retained_pass_count": 0,
                    "is_legal_reject": True,
                },
                {
                    "passing_test_ids": [],
                    "retained_test_ids": [],
                    "reference_pass_count": 0,
                    "retained_pass_count": 0,
                    "is_legal_reject": False,
                },
            ],
        )
        by_name = {}
        for row in rows:
            by_name.setdefault(row["row"], row)
        self.assertEqual(by_name["functional-delivery-rate"]["numerator"], 1)
        self.assertEqual(by_name["functional-delivery-rate"]["denominator"], 2)
        self.assertEqual(by_name["legal-rejects"]["count"], 1)
        self.assertEqual(by_name["not-evaluable"]["count"], 1)
        semantic = by_name["semantic-retention-of-accepted-changes"]
        self.assertEqual((semantic["numerator"], semantic["denominator"], semantic["reference"]), (3, 4, "R(S)"))
        self.assertEqual(by_name["semantic-legal-rejects-excluded"]["count"], 1)
        self.assertEqual(by_name["semantic-not-evaluable"]["count"], 1)

        empty = delivery_rows([], [])
        zero_rows = [row for row in empty if row["row"] == "zero-denominator"]
        self.assertEqual(len(zero_rows), 2)
        self.assertTrue(all("rate" not in row for row in zero_rows))

    def test_zero_event_bound_uses_components_not_proposals(self):
        bound = zero_event_component_bound(100)
        self.assertAlmostEqual(bound["upper"], 1 - 0.05 ** (1 / 100))
        self.assertAlmostEqual(bound["rule_of_three_approximation"], 0.03)
        self.assertEqual(bound["unit"], "shared-pr-connected-component")
        self.assertTrue(bound["bootstrap_degenerate_when_all_observations_are_zero"])
        self.assertTrue(bound["not_a_proposal_failure_rate"])
        with self.assertRaises(ValueError):
            zero_event_component_bound(0)

    def test_commit_time_order_uses_the_same_legal_set_key(self):
        """[3, 1] in commit-time order is the set {1, 3}, not a missing key."""

        def merger(current, _base, other):
            parts = set(current.split()) | set(other.split())
            return 0, b" ".join(sorted(parts))

        decision = decide(
            b"BASE",
            [
                side(pr=3, committer_time="2024-01-01T00:00:00Z", after=b"C"),
                side(pr=1, committer_time="2024-01-02T00:00:00Z", after=b"A"),
            ],
            merger,
        )
        full = next(row for row in decision.correct_answer["allowed"] if len(row["prs"]) == 2)
        self.assertEqual(legal_set_key([3, 1]), (1, 3))
        self.assertEqual(full["prs"], [1, 3])
        self.assertEqual(full["set_key"], [1, 3])
        self.assertIsNone(full["order"])
        self.assertNotIn([3, 1], [row["prs"] for row in decision.correct_answer["allowed"]])
        scored = score_run(
            decision.correct_answer,
            {"accepted_prs": [3, 1], "observed_sha256": full["sha256"], "acked": True},
        )
        self.assertEqual(scored["safety"], "pass")
        self.assertEqual(scored["accepted_prs"], [1, 3])
        self.assertNotEqual(scored["safety_reason"], "illegal-set")

    def test_stale_outside_candidate_is_discarded_and_counts_as_a_retry(self):
        changed = textual_merge_file_on_lock(outside_base="base-v1", inside_base="base-v2", retries_already_used=0)
        self.assertTrue(changed["discard_outside_candidate"])
        self.assertTrue(changed["recompute"])
        self.assertTrue(changed["counts_as_retry"])
        self.assertEqual(changed["retries_used"], 1)
        self.assertFalse(changed["may_commit_outside_candidate"])
        self.assertFalse(changed["clock_resets"])
        unchanged = textual_merge_file_on_lock(outside_base="base-v1", inside_base="base-v1", retries_already_used=3)
        self.assertFalse(unchanged["discard_outside_candidate"])
        self.assertFalse(unchanged["counts_as_retry"])
        self.assertTrue(unchanged["may_commit_outside_candidate"])
        exhausted = textual_merge_file_on_lock(outside_base="base-v1", inside_base="base-v2", retries_already_used=8)
        self.assertTrue(exhausted["discard_outside_candidate"])
        self.assertFalse(exhausted["recompute"])
        self.assertFalse(exhausted["may_commit_outside_candidate"])
        self.assertEqual(exhausted["stop_reason"], "retry-budget-exhausted")
        self.assertEqual(exhausted["retries_used"], 8)

    def test_timeout_ack_reconciliation_terminal_states(self):
        late_ack = reconcile_terminal(
            {
                "send_time": 0,
                "item_stop_time": 30,
                "rename_time": 10,
                "ack_time": 31,
                "entry_points_stopped": True,
                "live_entry_points": [],
            }
        )
        self.assertEqual(late_ack["terminal"], "durable-unacked")
        self.assertEqual(late_ack["stop_reason"], "ack-late")
        self.assertNotEqual(late_ack["terminal"], "success")
        self.assertNotEqual(late_ack["terminal"], "late-commit-after-timeout")
        self.assertFalse(late_ack["in_throughput"])

        missing_ack = reconcile_terminal(
            {
                "send_time": 0,
                "item_stop_time": 30,
                "rename_time": 10,
                "ack_time": None,
                "entry_points_stopped": True,
                "live_entry_points": [],
            }
        )
        self.assertEqual((missing_ack["terminal"], missing_ack["stop_reason"]), ("durable-unacked", "ack-missing"))

        late_commit = reconcile_terminal(
            {
                "send_time": 0,
                "item_stop_time": 30,
                "rename_time": 30.5,
                "ack_time": None,
                "entry_points_stopped": True,
                "live_entry_points": [],
            }
        )
        self.assertEqual(late_commit["terminal"], "late-commit-after-timeout")
        self.assertEqual(late_commit["stop_reason"], "rename-after-stop")
        self.assertFalse(late_commit["in_throughput"])

        still_running = reconcile_terminal(
            {
                "send_time": 0,
                "item_stop_time": 30,
                "rename_time": 10,
                "ack_time": 12,
                "entry_points_stopped": False,
                "live_entry_points": ["writer-2"],
            }
        )
        self.assertEqual(still_running["terminal"], "reconciliation-incomplete")
        self.assertFalse(still_running["final"])
        self.assertEqual(still_running["stop_reason"], "entry-points-still-live")
        self.assertNotEqual(still_running["terminal"], "success")

        shortened = reconcile_terminal(
            {
                "send_time": 2,
                "first_submit_time": 2,
                "item_stop_time": 30,
                "rename_time": None,
                "ack_time": None,
                "entry_points_stopped": True,
                "live_entry_points": [],
            }
        )
        self.assertEqual(shortened["executable_seconds"], 28)
        self.assertEqual(shortened["terminal"], "timeout")
        self.assertEqual(shortened["stop_reason"], "item-stop")
        self.assertEqual(shortened["counted_as"], "submitted-not-success")
        self.assertFalse(shortened["in_throughput"])

    def test_zero_denominator_is_not_dropped_or_reweighted(self):
        pooled = equal_weight_pool(
            [
                {"project": "django", "numerator": 1, "denominator": 5, "weight": 1 / 3},
                {"project": "flask", "numerator": 4, "denominator": 5, "weight": 1 / 3},
                {"project": "requests", "numerator": 0, "denominator": 0, "weight": 1 / 3},
            ]
        )
        reweighted = (1 / 5 + 4 / 5) / 2
        self.assertIsNone(pooled["point_estimate"])
        self.assertIsNone(pooled["interval"])
        self.assertEqual(pooled["status"], "undefined-zero-denominator")
        self.assertEqual(pooled["zero_denominator_projects"], ["requests"])
        self.assertFalse(pooled["dropped"])
        self.assertFalse(pooled["reweighted"])
        self.assertNotEqual(pooled["point_estimate"], reweighted)
        self.assertAlmostEqual(pooled["weight"], 1 / 3)

        interval = bootstrap_interval(
            [
                {"point_estimate": 0.2, "denominator": 5},
                {"point_estimate": 0.8, "denominator": 5},
                {"point_estimate": None, "denominator": 0, "status": "undefined-zero-denominator"},
            ]
        )
        self.assertIsNone(interval["low"])
        self.assertIsNone(interval["high"])
        self.assertEqual(interval["undefined_replicates"], [2])
        self.assertFalse(interval["dropped"])
        self.assertFalse(interval["reweighted"])

    def test_reference_without_passing_tests_is_not_evaluable(self):
        row = {
            "passing_test_ids": [],
            "retained_test_ids": [],
            "reference_pass_count": 0,
            "retained_pass_count": 0,
            "is_legal_reject": False,
            "has_reference_tests": True,
        }
        self.assertEqual(semantic_status(row), "not-evaluable")
        rows = delivery_rows(
            [{"has_tests": True, "delivered": False, "legally_rejected": False}],
            [row],
        )
        by_name = {item["row"]: item for item in rows}
        self.assertEqual(by_name["semantic-not-evaluable"]["count"], 1)
        self.assertEqual(by_name["semantic-not-evaluable"]["reason"], "no-passing-tests-on-R(S)")
        self.assertNotIn("semantic-retention-of-accepted-changes", by_name)
        zero = next(item for item in rows if item["row"] == "zero-denominator" and item["metric"].startswith("semantic"))
        self.assertNotIn("rate", zero)
        schema = json.loads((ROOT / "schema" / "score-input.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema["$id"], "hist-v2-score-input/5")
        self.assertEqual(schema["$ref"], "#/$defs/scoreInput")
        self.assertIn("retained_test_ids", schema["$defs"]["semanticEvaluation"]["required"])
        self.assertTrue(schema["$defs"]["semanticEvaluation"]["histV2Bounds"])

    def test_score_schema_validates_instances_not_just_fields(self):
        valid_semantic = {
            "passing_test_ids": ["t1", "t2"],
            "retained_test_ids": ["t1"],
            "reference_pass_count": 2,
            "retained_pass_count": 1,
            "is_legal_reject": False,
        }
        self.assertEqual(validate_score_instance(valid_semantic), valid_semantic)
        valid_acceptance = {"accepted_prs": [3, 1], "observed_sha256": "abc", "acked": True}
        self.assertEqual(validate_score_instance(valid_acceptance), valid_acceptance)

        over_retained = {
            "passing_test_ids": ["t1"],
            "reference_pass_count": 1,
            "retained_pass_count": 2,
            "is_legal_reject": False,
        }
        with self.assertRaises(ScoreInputError) as over:
            validate_score_instance(over_retained)
        self.assertTrue(any("retained_pass_count exceeds reference_pass_count" in message for message in over.exception.messages))

        duplicate_ids = {
            "passing_test_ids": ["t1", "t1"],
            "retained_test_ids": ["t1"],
            "reference_pass_count": 2,
            "retained_pass_count": 1,
            "is_legal_reject": False,
        }
        with self.assertRaises(ScoreInputError) as duplicated:
            validate_score_instance(duplicate_ids)
        self.assertTrue(any("non-unique" in message for message in duplicated.exception.messages))

        not_subset = {
            "passing_test_ids": ["t1"],
            "retained_test_ids": ["t2"],
            "reference_pass_count": 1,
            "retained_pass_count": 1,
            "is_legal_reject": False,
        }
        with self.assertRaises(ScoreInputError) as subset:
            validate_score_instance(not_subset)
        self.assertTrue(any("not a subset" in message for message in subset.exception.messages))

        negative = {
            "passing_test_ids": [],
            "retained_test_ids": [],
            "reference_pass_count": -1,
            "retained_pass_count": 0,
            "is_legal_reject": False,
        }
        with self.assertRaises(ScoreInputError):
            validate_score_instance(negative)

    def test_resample_final_report_keeps_point_and_undefines_interval(self):
        report = resample_final_report(
            [
                {"project": "django", "numerator": 1, "denominator": 2},
                {"project": "flask", "numerator": 1, "denominator": 2},
            ],
            [
                {"point_estimate": 0.5, "denominator": 4},
                {"point_estimate": 0.25, "denominator": 4},
                {"point_estimate": 0.75, "denominator": 4},
                {"point_estimate": None, "denominator": 0, "status": "undefined-zero-denominator"},
            ],
        )
        defined_only = bootstrap_interval(
            [
                {"point_estimate": 0.5, "denominator": 4},
                {"point_estimate": 0.25, "denominator": 4},
                {"point_estimate": 0.75, "denominator": 4},
            ]
        )
        self.assertEqual(
            report,
            {
                "policy": "point-reported-interval-undefined",
                "point_estimate": 0.5,
                "point_status": "defined",
                "interval_low": None,
                "interval_high": None,
                "interval_status": "undefined-zero-denominator",
                "resample_count": 4,
                "undefined_resample_count": 1,
                "undefined_resample_fraction": 0.25,
                "undefined_resample_indexes": [3],
                "dropped": False,
                "reweighted": False,
                "weight": 0.5,
                "project_count": 2,
                "defined_resample_percentile_not_used": True,
            },
        )
        self.assertNotEqual(report["interval_low"], defined_only["low"])
        self.assertNotEqual(report["interval_high"], defined_only["high"])

    def test_combined_success_requires_time_legal_set_and_bytes(self):
        reference = _sha(b"R(S)")
        base = _sha(b"BASE")
        answer = {
            "allowed": [{"prs": [1, 3], "set_key": [1, 3], "sha256": reference, "maximal": True}],
            "unchanged_base_sha256": base,
            "full_reject_allowed": False,
        }
        on_time = {
            "send_time": 0,
            "item_stop_time": 30,
            "rename_time": 10,
            "ack_time": 12,
            "entry_points_stopped": True,
            "live_entry_points": [],
        }
        matched = {"accepted_prs": [3, 1], "observed_sha256": reference, "acked": True}
        success = proposal_final_report(on_time, answer, matched)
        self.assertEqual(success["counts_as_success"], True)
        self.assertEqual(success["in_throughput"], True)
        self.assertEqual(success["mismatch"], [])
        self.assertFalse(success["terminal"]["in_throughput"])
        self.assertTrue(success["terminal"]["time_window_success"])

        wrong_bytes = proposal_final_report(
            on_time,
            answer,
            {"accepted_prs": [1, 3], "observed_sha256": _sha(b"nope"), "acked": True},
        )
        self.assertFalse(wrong_bytes["counts_as_success"])
        self.assertEqual(wrong_bytes["mismatch"], ["bytes:bytes-do-not-match-R(S)"])

        durable = proposal_final_report(
            {**on_time, "ack_time": 31},
            answer,
            {"accepted_prs": [1, 3], "observed_sha256": reference, "acked": False},
        )
        self.assertFalse(durable["counts_as_success"])
        self.assertEqual(durable["mismatch"], ["time:durable-unacked"])
        self.assertEqual(durable["terminal"]["stop_reason"], "ack-late")

        late_commit = proposal_final_report(
            {**on_time, "rename_time": 30.5, "ack_time": None},
            answer,
            {"accepted_prs": [1, 3], "observed_sha256": reference, "acked": False},
        )
        self.assertFalse(late_commit["counts_as_success"])
        self.assertEqual(late_commit["mismatch"], ["time:late-commit-after-timeout"])

        illegal = proposal_final_report(
            on_time,
            answer,
            {"accepted_prs": [9], "observed_sha256": reference, "acked": True},
        )
        self.assertFalse(illegal["counts_as_success"])
        self.assertEqual(illegal["mismatch"], ["set:illegal-set"])

        incomplete = proposal_final_report(
            {**on_time, "entry_points_stopped": False, "live_entry_points": ["writer-2"]},
            answer,
            matched,
        )
        self.assertFalse(incomplete["counts_as_success"])
        self.assertEqual(incomplete["mismatch"], ["time:reconciliation-incomplete"])

        timed_out = proposal_final_report(
            {**on_time, "rename_time": None, "ack_time": None},
            answer,
            {"accepted_prs": [], "observed_sha256": base, "acked": False},
        )
        self.assertFalse(timed_out["counts_as_success"])
        self.assertIn("time:timeout", timed_out["mismatch"])
        self.assertFalse(timed_out["in_throughput"])


if __name__ == "__main__":
    unittest.main()
