"""Pure decision, distance, semantic, and grouping tests. No network."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from hist_v2_classify_v2.classify import SideView, decide  # noqa: E402
from hist_v2_classify_v2.gitio import ALLOWED_GIT  # noqa: E402
from hist_v2_classify_v2.hunks import dist, stratum_for  # noqa: E402
from hist_v2_classify_v2.labels import (  # noqa: E402
    apply_holdout_leakage,
    assign_clusters,
    assign_ids,
    infer_set,
    semantic_assessment,
)
from hist_v2_classify_v2.parameters import ADJACENT_MAX_DISTANCE  # noqa: E402
from hist_v2_classify_v2.pipeline import parse_candidate  # noqa: E402


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
        self.assertEqual(len(decision.blobs), 2)

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
        allowed = {tuple(row["prs"]) for row in decision.correct_answer["allowed"]}
        self.assertEqual(allowed, {(1, 3), (2, 3)})
        self.assertTrue(all(row["maximal"] for row in decision.correct_answer["allowed"]))
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


if __name__ == "__main__":
    unittest.main()
