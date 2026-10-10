"""Integration tests on a tiny local git repository. No network."""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from hist_v2_classify_v2.cli import main  # noqa: E402
from hist_v2_classify_v2.parameters import EXCLUSION_REASONS  # noqa: E402


def file_lines(n, repl=None) -> bytes:
    repl = {} if repl is None else repl
    rows = []
    for index in range(1, n + 1):
        rows.append(repl.get(index, f"L{index:02d}"))
    return ("\n".join(rows) + "\n").encode()


def merge_file(current: bytes, base: bytes, other: bytes) -> tuple[int, bytes]:
    temp = tempfile.mkdtemp(prefix="hist-v2-oracle-")
    try:
        paths = []
        for name, blob in (("cur", current), ("base", base), ("other", other)):
            path = os.path.join(temp, name)
            with open(path, "wb") as handle:
                handle.write(blob)
            paths.append(path)
        result = subprocess.run(
            ["git", "merge-file", "-p", "-L", "cur", "-L", "base", "-L", "other", *paths],
            capture_output=True,
        )
        return result.returncode, result.stdout
    finally:
        shutil.rmtree(temp)


def sha256(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


class Repo:
    def __init__(self, path: str):
        self.path = path
        subprocess.check_call(["git", "init", "-q", "-b", "main", path])
        subprocess.check_call(["git", "-C", path, "config", "user.email", "hist-v2@example.com"])
        subprocess.check_call(["git", "-C", path, "config", "user.name", "hist-v2"])
        subprocess.check_call(["git", "-C", path, "config", "commit.gpgsign", "false"])

    def commit_on(self, parent: str | None, updates: dict, message: str, when: str) -> str:
        if parent:
            subprocess.check_call(["git", "-C", self.path, "checkout", "-q", "--detach", parent])
        for rel, content in updates.items():
            dest = os.path.join(self.path, rel)
            if content is None:
                os.remove(dest)
            else:
                parent_dir = os.path.dirname(dest)
                if parent_dir:
                    os.makedirs(parent_dir, exist_ok=True)
                with open(dest, "wb") as handle:
                    handle.write(content)
            subprocess.check_call(["git", "-C", self.path, "add", "-A", "--", rel])
        env = os.environ.copy()
        env["GIT_AUTHOR_DATE"] = when
        env["GIT_COMMITTER_DATE"] = when
        subprocess.check_call(["git", "-C", self.path, "commit", "-q", "-m", message], env=env)
        return subprocess.check_output(["git", "-C", self.path, "rev-parse", "HEAD"], text=True).strip()

    def blob(self, rev: str, path: str) -> bytes:
        return subprocess.check_output(["git", "-C", self.path, "cat-file", "-p", f"{rev}:{path}"])


def patch(pr, head, when, mb, **extra):
    row = {
        "pr": pr,
        "mb": mb,
        "head": head,
        "committer_time": when,
        "merged_at": when,
    }
    row.update(extra)
    return row


class ClassifierCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="hist-v2-cli-")
        cls.repo = Repo(os.path.join(cls.tmp.name, "repo"))
        base_files = {
            "pkg/a.py": file_lines(30),
            "pkg/b.py": file_lines(30),
            "pkg/c.py": file_lines(30),
            "pkg/d.py": file_lines(30),
            "pkg/e.py": file_lines(40),
            "pkg/t.py": file_lines(30),
            "pkg/r.py": file_lines(30),
            "pkg/u.py": file_lines(30),
            "pkg/old.py": file_lines(12),
            "pkg/large.py": file_lines(450),
            "README.md": "".join(f"R{i:02d}\n" for i in range(1, 11)).encode(),
            "pkg/bin.dat": b"\0abc",
        }
        cls.base = cls.repo.commit_on(None, base_files, "base", "2024-01-01T00:00:00Z")
        r = cls.repo
        b = cls.base
        cls.heads = {}

        def add(pr, updates, when, parent=None):
            cls.heads[pr] = r.commit_on(b if parent is None else parent, updates, f"pr{pr}", when)
            return cls.heads[pr]

        add(1, {"pkg/a.py": file_lines(30, {1: "A1"})}, "2024-02-01T00:00:00Z")
        add(2, {"pkg/a.py": file_lines(30, {29: "A29"}), "pkg/b.py": file_lines(30, {1: "B1"})}, "2024-02-02T00:00:00Z")
        add(3, {"pkg/a.py": file_lines(30, {10: "A10"})}, "2024-02-03T00:00:00Z")
        add(4, {"pkg/a.py": file_lines(30, {12: "A12"})}, "2024-02-04T00:00:00Z")
        add(5, {"pkg/a.py": file_lines(30, {15: "AAA"})}, "2024-02-05T00:00:00Z")
        add(6, {"pkg/a.py": file_lines(30, {15: "BBB"})}, "2024-02-06T00:00:00Z")
        add(7, {"pkg/a.py": file_lines(30, {8: "SAME"})}, "2024-02-07T00:00:00Z")
        add(8, {"pkg/a.py": file_lines(30, {8: "SAME"})}, "2024-02-08T00:00:00Z")
        add(9, {"pkg/new.py": b"created-a\n"}, "2024-02-09T00:00:00Z")
        add(10, {"pkg/new.py": b"created-b\n"}, "2024-02-10T00:00:00Z")
        add(11, {"pkg/d.py": None}, "2024-02-11T00:00:00Z")
        add(12, {"pkg/d.py": file_lines(30, {1: "GONE"})}, "2024-02-12T00:00:00Z")
        add(13, {"pkg/bin.dat": b"\0abd"}, "2024-02-13T00:00:00Z")
        add(14, {"pkg/bin.dat": b"\0abe"}, "2024-02-14T00:00:00Z")
        add(16, {"pkg/a.py": file_lines(30, {2: "A2"})}, "2024-02-16T00:00:00Z")
        add(17, {"pkg/a.py": file_lines(30, {4: "A4"})}, "2024-02-17T00:00:00Z")
        add(18, {"pkg/a.py": file_lines(30, {25: "A25"})}, "2024-02-18T00:00:00Z")
        add(19, {"pkg/large.py": file_lines(450, {1: "BIG1"})}, "2024-02-19T00:00:00Z")
        add(21, {"pkg/large.py": file_lines(450, {450: "BIG450"})}, "2024-02-21T00:00:00Z")
        add(20, {"pkg/b.py": file_lines(30, {29: "B29"})}, "2026-04-01T00:00:00Z")
        add(30, {"pkg/c.py": file_lines(30, {1: "C1"})}, "2026-03-01T00:00:00Z")
        add(31, {"pkg/c.py": file_lines(30, {30: "C30"})}, "2026-03-02T00:00:00Z")
        add(60, {"pkg/e.py": file_lines(40, {5: "AAA"})}, "2024-05-01T00:00:00Z")
        add(61, {"pkg/e.py": file_lines(40, {5: "BBB"})}, "2024-05-02T00:00:00Z")
        add(62, {"pkg/e.py": file_lines(40, {40: "CCC"})}, "2024-05-03T00:00:00Z")
        add(90, {"pkg/a.py": file_lines(30, {1: "EDGE1"})}, "2024-06-01T00:00:00Z")
        add(91, {"pkg/a.py": file_lines(30, {5: "EDGE5"})}, "2024-06-02T00:00:00Z")
        add(92, {"pkg/a.py": file_lines(30, {1: "FAR1"})}, "2024-06-03T00:00:00Z")
        add(93, {"pkg/a.py": file_lines(30, {6: "FAR6"})}, "2024-06-04T00:00:00Z")
        add(80, {"pkg/a.py": file_lines(30, {2: "X2"}), "pkg/b.py": file_lines(30, {2: "Y2"})}, "2024-07-01T00:00:00Z")
        add(81, {"pkg/a.py": file_lines(30, {28: "X28"}), "pkg/b.py": file_lines(30, {28: "Y28"})}, "2024-07-02T00:00:00Z")
        add(100, {"README.md": b"only-doc-a\n"}, "2024-07-03T00:00:00Z")
        add(101, {"README.md": b"only-doc-b\n"}, "2024-07-04T00:00:00Z")
        readme = "".join(f"R{i:02d}\n" for i in range(1, 11))
        add(102, {"README.md": readme.replace("R01\n", "R01a\n", 1).encode()}, "2024-07-05T00:00:00Z")
        add(103, {"README.md": readme.replace("R10\n", "R10b\n", 1).encode()}, "2024-07-06T00:00:00Z")
        test_a = b"def test_a():\n    assert True\n"
        test_b = b"def test_b():\n    assert True\n"
        add(84, {"pkg/a.py": file_lines(30, {7: "G7"}), "tests/test_mod.py": test_a}, "2024-07-07T00:00:00Z")
        add(85, {"pkg/a.py": file_lines(30, {27: "G27"}), "tests/test_mod.py": test_b}, "2024-07-08T00:00:00Z")
        old = file_lines(12)
        add(120, {"pkg/old.py": None, "pkg/renamed.py": old}, "2024-08-01T00:00:00Z")
        add(121, {"pkg/old.py": file_lines(12, {1: "EDIT"})}, "2024-08-02T00:00:00Z")

        cls.mb_a = add(401, {"pkg/t.py": file_lines(30, {3: "XXX"})}, "2024-08-10T00:00:00Z")
        cls.head_a = r.commit_on(cls.mb_a, {"pkg/t.py": file_lines(30, {1: "YYY", 3: "XXX"})}, "pr40", "2024-08-11T00:00:00Z")
        cls.heads[40] = cls.head_a
        add(41, {"pkg/t.py": file_lines(30, {30: "ZZZ"})}, "2024-08-12T00:00:00Z")

        cls.pre = add(501, {"pkg/r.py": file_lines(30, {1: "PRE"})}, "2024-08-20T00:00:00Z")
        cls.mb_final = add(502, {"pkg/r.py": file_lines(30, {2: "CTX"})}, "2024-08-21T00:00:00Z")
        cls.head_final = r.commit_on(
            cls.mb_final,
            {"pkg/r.py": file_lines(30, {1: "FINAL", 2: "CTX"})},
            "pr50",
            "2024-08-22T00:00:00Z",
        )
        cls.heads[50] = cls.head_final
        add(51, {"pkg/r.py": file_lines(30, {30: "END"})}, "2024-08-23T00:00:00Z")

        cls.mb_u = add(701, {"pkg/u.py": file_lines(30, {1: "AAA"})}, "2024-09-01T00:00:00Z")
        cls.head_u = r.commit_on(cls.mb_u, {"pkg/u.py": file_lines(30, {1: "BBB"})}, "pr70", "2024-09-02T00:00:00Z")
        cls.heads[70] = cls.head_u
        add(71, {"pkg/u.py": file_lines(30, {30: "TAIL"})}, "2024-09-03T00:00:00Z")

        cls.out = os.path.join(cls.tmp.name, "out")
        candidates = cls._candidates()
        cand_path = os.path.join(cls.tmp.name, "candidates.jsonl")
        with open(cand_path, "w", encoding="utf-8") as handle:
            for row in candidates:
                handle.write(json.dumps(row) + "\n")
        validity = os.path.join(cls.tmp.name, "validity.jsonl")
        with open(validity, "w", encoding="utf-8") as handle:
            for pr in (84, 85):
                handle.write(json.dumps({"project": "synth", "pr": pr, "base_validity": "pass"}) + "\n")
        cls.cand_path = cand_path
        cls.validity = validity
        status = main(["--repo", cls.repo.path, "--candidates", cand_path, "--validity", validity, "--out-dir", cls.out])
        if status != 0:
            raise RuntimeError(f"classifier exited {status}")
        cls.items = _read_jsonl(os.path.join(cls.out, "items.jsonl"))
        cls.excluded = _read_jsonl(os.path.join(cls.out, "excluded.jsonl"))
        with open(os.path.join(cls.out, "summary.json"), encoding="utf-8") as handle:
            cls.summary = json.load(handle)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    @classmethod
    def _candidates(cls):
        b = cls.base
        h = cls.heads
        gold = {"gold_test_ids": ["tests.test_a.Case"], "base_validity": "pass"}

        def pair(left, right, target, **extra):
            row = {
                "project": "synth",
                "base": b,
                "target_file": target,
                "patches": [
                    patch(left, h[left], _when(left), b),
                    patch(right, h[right], _when(right), b),
                ],
            }
            row.update(extra)
            return row

        rows = [
            pair(1, 2, "pkg/a.py", arm_result="win", patches=[
                patch(1, h[1], "2024-02-01T00:00:00Z", b, **gold),
                patch(2, h[2], "2024-02-02T00:00:00Z", b, **gold),
            ]),
            pair(3, 4, "pkg/a.py"),
            pair(5, 6, "pkg/a.py"),
            pair(7, 8, "pkg/a.py"),
            pair(9, 10, "pkg/new.py"),
            pair(11, 12, "pkg/d.py"),
            pair(13, 14, "pkg/bin.dat"),
            {
                "project": "synth",
                "base": b,
                "target_file": "pkg/a.py",
                "patches": [
                    patch(15, "0123456789abcdef0123456789abcdef01234567", "2024-02-15T00:00:00Z", b),
                    patch(16, h[16], "2024-02-16T00:00:00Z", b),
                ],
            },
            pair(17, 18, "pkg/a.py", patches=[
                patch(17, h[17], "2024-02-17T00:00:00Z", b, gold_test_ids=["t"], base_validity="unbuildable"),
                patch(18, h[18], "2024-02-18T00:00:00Z", b, gold_test_ids=["t"], base_validity="unbuildable"),
            ]),
            pair(19, 21, "pkg/large.py"),
            pair(2, 20, "pkg/b.py", patches=[
                patch(2, h[2], "2024-02-02T00:00:00Z", b, merged_at="2024-02-02T00:00:00Z"),
                patch(20, h[20], "2026-04-01T00:00:00Z", b, merged_at="2026-04-01T00:00:00Z"),
            ]),
            pair(30, 31, "pkg/c.py", patches=[
                patch(30, h[30], "2026-03-01T00:00:00Z", b),
                patch(31, h[31], "2026-03-02T00:00:00Z", b),
            ]),
            pair(60, 61, "pkg/e.py", patches=[
                patch(60, h[60], "2024-05-01T00:00:00Z", b),
                patch(61, h[61], "2024-05-02T00:00:00Z", b),
                patch(62, h[62], "2024-05-03T00:00:00Z", b),
            ]),
            pair(90, 91, "pkg/a.py"),
            pair(92, 93, "pkg/a.py"),
            {
                "project": "synth",
                "base": b,
                "patches": [
                    patch(80, h[80], "2024-07-01T00:00:00Z", b),
                    patch(81, h[81], "2024-07-02T00:00:00Z", b),
                ],
            },
            {
                "project": "synth",
                "base": b,
                "patches": [
                    patch(100, h[100], "2024-07-03T00:00:00Z", b),
                    patch(101, h[101], "2024-07-04T00:00:00Z", b),
                ],
            },
            pair(102, 103, "README.md"),
            {
                "project": "synth",
                "base": b,
                "target_file": "pkg/a.py",
                "patches": [
                    patch(84, h[84], "2024-07-07T00:00:00Z", b),
                    patch(85, h[85], "2024-07-08T00:00:00Z", b),
                ],
            },
            pair(120, 121, "pkg/old.py"),
            {
                "project": "synth",
                "base": b,
                "target_file": "pkg/t.py",
                "patches": [
                    patch(40, cls.head_a, "2024-08-11T00:00:00Z", cls.mb_a),
                    patch(41, h[41], "2024-08-12T00:00:00Z", b),
                ],
            },
            {
                "project": "synth",
                "base": b,
                "target_file": "pkg/r.py",
                "patches": [
                    patch(
                        50,
                        cls.head_final,
                        "2024-08-22T00:00:00Z",
                        cls.mb_final,
                        pre_rebase_head=cls.pre,
                        pre_rebase_mb=b,
                        **gold,
                    ),
                    patch(51, h[51], "2024-08-23T00:00:00Z", b, **gold),
                ],
            },
            {
                "project": "synth",
                "base": b,
                "target_file": "pkg/u.py",
                "patches": [
                    patch(70, cls.head_u, "2024-09-02T00:00:00Z", cls.mb_u),
                    patch(71, h[71], "2024-09-03T00:00:00Z", b),
                ],
            },
            {
                "project": "synth",
                "base": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "target_file": "pkg/a.py",
                "patches": [
                    patch(72, h[1], "2024-02-01T00:00:00Z", b),
                    patch(73, h[16], "2024-02-16T00:00:00Z", b),
                ],
            },
        ]
        return rows

    def test_rules_hash_and_summary_contract(self):
        recorded = (ROOT / "RULES.sha256").read_text(encoding="utf-8").split()[0]
        digest = hashlib.sha256((ROOT / "RULES.md").read_bytes()).hexdigest()
        self.assertEqual(recorded, digest)
        self.assertEqual(self.summary["rules_sha256"], digest)
        self.assertFalse(self.summary["claims_benchmark_wins"])
        self.assertFalse(self.summary["ran_benchmark_arms"])
        self.assertEqual(self.summary["design_status"], "draft-not-frozen-prereg")
        self.assertEqual(self.summary["item_count"], len(self.items))
        self.assertEqual(self.summary["excluded_count"], len(self.excluded))
        for reason in self.summary["excluded_by_reason"]:
            self.assertIn(reason, EXCLUSION_REASONS)
        self.assertNotIn("shared-pr-with-dev", self.summary["excluded_by_reason"])

    def test_class_a_keeps_both_effects_and_flag_s(self):
        item = self._find([1, 2], "pkg/a.py")
        self.assertEqual(item["write_class"], "A")
        self.assertEqual(item["stratum"], "O3")
        self.assertGreater(item["min_dist"], 3)
        self.assertEqual(item["semantic_flag"], "S")
        self.assertEqual(item["semantic_reasons"], [])
        self.assertEqual(item["test_purpose_code"], "general-write")
        self.assertEqual(item["fixed_test_ids"], ["tests.test_a.Case"])
        self.assertEqual(item["send_order"], [1, 2])
        self.assertNotIn("arm_result", json.dumps(item))
        self._assert_merge_oracle(item, "pkg/a.py", self.heads[1], self.heads[2])

    def test_class_b_and_distance_boundaries(self):
        near = self._find([3, 4], "pkg/a.py")
        self.assertEqual(near["write_class"], "B")
        self.assertEqual(near["stratum"], "O2")
        self.assertEqual(near["min_dist"], 1)
        self.assertEqual(near["semantic_flag"], "N")
        self.assertIn("no-gold", near["semantic_reasons"])
        self._assert_merge_oracle(near, "pkg/a.py", self.heads[3], self.heads[4])
        edge = self._find([90, 91], "pkg/a.py")
        self.assertEqual((edge["write_class"], edge["min_dist"], edge["stratum"]), ("B", 3, "O2"))
        far = self._find([92, 93], "pkg/a.py")
        self.assertEqual((far["write_class"], far["min_dist"], far["stratum"]), ("A", 4, "O3"))

    def test_class_c_rejects_without_mixed_bytes(self):
        item = self._find([5, 6], "pkg/a.py")
        self.assertEqual(item["write_class"], "C")
        self.assertEqual(item["stratum"], "O1")
        self.assertEqual(item["test_purpose_code"], "reject")
        allowed = {tuple(row["prs"]) for row in item["correct_answer"]["allowed"]}
        self.assertEqual(allowed, {(5,), (6,)})
        self._assert_no_conflict_markers(item)
        rc, mixed = merge_file(self.repo.blob(self.heads[5], "pkg/a.py"), self.repo.blob(self.base, "pkg/a.py"), self.repo.blob(self.heads[6], "pkg/a.py"))
        self.assertNotEqual(rc, 0)
        self.assertNotIn(sha256(mixed), {row["sha256"] for row in item["correct_answer"]["allowed"]})

    def test_three_sided_compatible_subset(self):
        item = self._find([60, 61, 62], "pkg/e.py")
        self.assertEqual(item["write_class"], "C")
        allowed = {tuple(row["prs"]) for row in item["correct_answer"]["allowed"]}
        self.assertEqual(allowed, {(60, 62), (61, 62)})
        self.assertNotIn((60,), allowed)
        self.assertNotIn((62,), allowed)
        self.assertFalse(item["correct_answer"]["full_reject_allowed"])
        self.assertIn("文字合併標準", item["correct_answer"]["textual_merge_standard_note_zh"])
        self._assert_no_conflict_markers(item)
        left = self.repo.blob(self.heads[60], "pkg/e.py")
        right = self.repo.blob(self.heads[62], "pkg/e.py")
        rc, merged = merge_file(left, self.repo.blob(self.base, "pkg/e.py"), right)
        self.assertEqual(rc, 0)
        match = [row for row in item["correct_answer"]["allowed"] if row["prs"] == [60, 62]]
        self.assertEqual(match[0]["sha256"], sha256(merged))

    def test_identical_and_structural_classes(self):
        identical = self._find([7, 8], "pkg/a.py")
        self.assertEqual(identical["write_class"], "A'")
        self.assertEqual(identical["test_purpose_code"], "identical-edits")
        self.assertEqual(identical["correct_answer"]["expected_sha256"], sha256(self.repo.blob(self.heads[7], "pkg/a.py")))
        created = self._find([9, 10], "pkg/new.py")
        deleted = self._find([11, 12], "pkg/d.py")
        renamed = self._find([120, 121], "pkg/old.py")
        for item in (created, deleted, renamed):
            self.assertEqual(item["write_class"], "D")
            self.assertEqual(item["correct_answer"]["kind"], "write-safety-fail-closed")
            self.assertIsNone(item["correct_answer"]["expected_sha256"])
            self.assertFalse(any(row["id"] == item["id"] for row in _read_jsonl(os.path.join(self.out, "expected", "manifest.jsonl"))))

    def test_exclusions_and_non_exclusions(self):
        reasons = {(tuple(row["prs"]), row["reason"]) for row in self.excluded}
        self.assertIn(((13, 14), "binary-or-non-utf8"), reasons)
        self.assertIn(((15, 16), "head-unavailable"), reasons)
        self.assertIn(((72, 73), "checkout-failed"), reasons)
        self.assertIn(((100, 101), "unapplicable-to-common-base"), reasons)
        doc = [row for row in self.excluded if row["prs"] == [100, 101]][0]
        self.assertIn("no-common-source-file", doc["message"])
        unbuildable = self._find([17, 18], "pkg/a.py")
        self.assertEqual(unbuildable["write_class"], "A")
        self.assertEqual(unbuildable["semantic_flag"], "N")
        self.assertEqual(unbuildable["semantic_reasons"], ["base-env-unbuildable"])
        self.assertNotIn(17, {pr for row in self.excluded for pr in row["prs"]})
        large = self._find([19, 21], "pkg/large.py")
        self.assertEqual(large["write_class"], "A")
        self.assertEqual(large["covariates"]["target_line_count"], 450)
        self.assertNotIn(19, {pr for row in self.excluded for pr in row["prs"]})

    def test_grouping_cluster_and_held_out(self):
        dev = self._find([1, 2], "pkg/a.py")
        cross = self._find([2, 20], "pkg/b.py")
        held = self._find([30, 31], "pkg/c.py")
        self.assertEqual(dev["set"], "dev")
        self.assertEqual(cross["set"], "dev-cross-window")
        self.assertEqual(cross["grouping_codes"], ["shared-pr-component-leak"])
        self.assertEqual(held["set"], "later-period-historical-holdout")
        self.assertEqual(held["grouping_codes"], [])
        self.assertEqual(dev["cluster_id"], cross["cluster_id"])
        self.assertNotEqual(dev["cluster_id"], held["cluster_id"])
        self.assertEqual(self.summary["grouping_counts"].get("shared-pr-component-leak"), 1)

    def test_three_way_and_rebase_sources(self):
        item = self._find([40, 41], "pkg/t.py")
        self.assertEqual(item["write_class"], "A")
        sources = {row["pr"]: row["patch_source"] for row in item["patches"]}
        self.assertEqual(sources[40], "3way")
        self.assertEqual(sources[41], "final-head")
        expected = self._read_expected(item["correct_answer"]["expected_relpath"])
        self.assertIn(b"YYY\n", expected)
        self.assertIn(b"ZZZ\n", expected)
        self.assertNotIn(b"XXX\n", expected)
        self.assertIn(b"L03\n", expected)
        rebase = self._find([50, 51], "pkg/r.py")
        self.assertEqual(rebase["write_class"], "A")
        self.assertEqual(rebase["semantic_flag"], "N")
        self.assertIn("rebase-before-head", rebase["semantic_reasons"])
        sources = {row["pr"]: row["patch_source"] for row in rebase["patches"]}
        self.assertEqual(sources[50], "rebase-before-head")
        body = self._read_expected(rebase["correct_answer"]["expected_relpath"])
        self.assertIn(b"PRE\n", body)
        self.assertNotIn(b"FINAL\n", body)
        self.assertIn(b"END\n", body)
        conflicted = self._find([70, 71], "pkg/u.py")
        self.assertIsNone(conflicted["write_class"])
        self.assertNotEqual(conflicted["write_class"], "C")
        self.assertEqual(conflicted["concurrency_outcome"], "transplant-conflict")
        self.assertIn("transplant-conflict", conflicted["labels"])
        sources = {row["pr"]: row["patch_source"] for row in conflicted["patches"]}
        self.assertEqual(sources[70], "3way")
        transplanted = next(row for row in conflicted["patches"] if row["pr"] == 70)
        self.assertTrue(transplanted["transplant_conflict"])
        self.assertEqual(transplanted["placement"], "transplant-conflict")
        allowed = {tuple(row["prs"]) for row in conflicted["correct_answer"]["allowed"]}
        self.assertEqual(allowed, {(71,)})
        self.assertFalse(conflicted["correct_answer"]["full_reject_allowed"])
        self._assert_no_conflict_markers(conflicted)

    def test_auto_expansion_explicit_doc_and_discovered_gold(self):
        first = self._find([80, 81], "pkg/a.py")
        second = self._find([80, 81], "pkg/b.py")
        self.assertEqual(first["write_class"], "A")
        self.assertEqual(second["write_class"], "A")
        self.assertEqual(first["cluster_id"], second["cluster_id"])
        doc = self._find([102, 103], "README.md")
        self.assertEqual(doc["write_class"], "A")
        discovered = self._find([84, 85], "pkg/a.py")
        self.assertEqual(discovered["semantic_flag"], "S")
        self.assertEqual(discovered["fixed_test_ids"], ["tests/test_mod.py"])
        self.assertEqual(discovered["write_class"], "A")

    def test_rerun_is_byte_identical(self):
        other = os.path.join(self.tmp.name, "out2")
        status = main(["--repo", self.repo.path, "--candidates", self.cand_path, "--validity", self.validity, "--out-dir", other])
        self.assertEqual(status, 0)
        first = Path(self.out, "items.jsonl").read_bytes()
        second = Path(other, "items.jsonl").read_bytes()
        self.assertEqual(first, second)
        self.assertEqual(Path(self.out, "excluded.jsonl").read_bytes(), Path(other, "excluded.jsonl").read_bytes())

    def test_malformed_candidate_exits_2(self):
        path = os.path.join(self.tmp.name, "bad.jsonl")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({"project": "synth", "patches": [{"pr": 1, "mb": self.base, "head": self.heads[1]}]}) + "\n")
        out = os.path.join(self.tmp.name, "bad-out")
        errors = io.StringIO()
        with redirect_stderr(errors):
            status = main(["--repo", self.repo.path, "--candidates", path, "--out-dir", out])
        self.assertEqual(status, 2)
        self.assertIn("2 to 4", errors.getvalue())

    def _find(self, prs, target):
        want = set(prs)
        hits = [item for item in self.items if set(item["prs"]) == want and item["target_file"] == target]
        self.assertEqual(len(hits), 1, [item["id"] for item in self.items if set(item["prs"]) == want])
        return hits[0]

    def _assert_merge_oracle(self, item, path, left, right):
        base = self.repo.blob(self.base, path)
        rc, merged = merge_file(self.repo.blob(left, path), base, self.repo.blob(right, path))
        self.assertEqual(rc, 0)
        self.assertEqual(item["correct_answer"]["expected_sha256"], sha256(merged))
        self.assertEqual(self._read_expected(item["correct_answer"]["expected_relpath"]), merged)

    def _assert_no_conflict_markers(self, item):
        for row in item["correct_answer"]["allowed"]:
            blob = self._read_expected(row["expected_relpath"])
            self.assertNotIn(b"<<<<<<<", blob)
            self.assertEqual(sha256(blob), row["sha256"])

    def _read_expected(self, rel):
        with open(os.path.join(self.out, rel), "rb") as handle:
            return handle.read()


def _when(pr: int) -> str:
    return f"2024-01-01T00:{pr:02d}:00Z" if pr < 60 else f"2024-04-01T00:{pr % 60:02d}:00Z"


def _read_jsonl(path: str) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


if __name__ == "__main__":
    unittest.main()
