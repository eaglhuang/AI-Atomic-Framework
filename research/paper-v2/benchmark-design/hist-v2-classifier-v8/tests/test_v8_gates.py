"""Counterexamples for v8 path parsing, seal binding, and global leakage.

v7 tests stay in the copied modules. These tests fail on the v7 behavior:
quoted or NUL-delimited paths dropped downstream, a seal aimed at the old
draft, and per-batch leakage treated as if it were the global component.
"""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from hist_v2_classify_v8.gitio import (  # noqa: E402
    name_status,
    parse_name_status_text,
    unquote_git_path,
)
from hist_v2_classify_v8.labels import apply_holdout_leakage  # noqa: E402
from hist_v2_classify_v8.parameters import DEV_WINDOW, HELDOUT_WINDOW  # noqa: E402
from hist_v2_classify_v8.paths import repo_relative_path_issue  # noqa: E402
from hist_v2_classify_v8.pipeline import (  # noqa: E402
    MalformedCandidate,
    classify_across_batches,
    classify_candidates,
    parse_candidate,
)


SPECIAL_PATHS = (
    "dir/space name.py",
    "dir/tab\tname.py",
    "dir/quote\"name.py",
    "dir/back\\slash.py",
    "dir/檔案.py",
    "dir/-dash.py",
    "dir/new\nline.py",
)


def _git(repo: str, *args: str, env: dict | None = None) -> str:
    return subprocess.check_output(["git", "-C", repo, *args], env=env, text=True).strip()


def _init(path: str) -> None:
    subprocess.check_call(["git", "init", "-q", "-b", "main", path])
    subprocess.check_call(["git", "-C", path, "config", "user.email", "hist-v2@example.com"])
    subprocess.check_call(["git", "-C", path, "config", "user.name", "hist-v2"])
    subprocess.check_call(["git", "-C", path, "config", "commit.gpgsign", "false"])
    subprocess.check_call(["git", "-C", path, "config", "core.quotePath", "true"])


def _write(repo: str, rel: str, content: bytes) -> None:
    dest = os.path.join(repo, *rel.split("/"))
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(dest, "wb") as handle:
        handle.write(content)


def _commit_all(repo: str, message: str, when: str) -> str:
    subprocess.check_call(["git", "-C", repo, "add", "-A"])
    env = os.environ.copy()
    env["GIT_AUTHOR_DATE"] = when
    env["GIT_COMMITTER_DATE"] = when
    subprocess.check_call(["git", "-C", repo, "commit", "-q", "-m", message], env=env)
    return _git(repo, "rev-parse", "HEAD")


def _lines(n: int, repl: dict | None = None) -> bytes:
    repl = {} if repl is None else repl
    rows = [repl.get(index, f"L{index:02d}") for index in range(1, n + 1)]
    return ("\n".join(rows) + "\n").encode()


class PathChainTests(unittest.TestCase):
    def test_quoted_listing_without_unquote_is_the_wrong_key(self):
        quoted = 'A\t"dir/quote\\"name.py"'
        naive = quoted.split("\t")[1]
        self.assertNotEqual(naive, 'dir/quote"name.py')
        self.assertEqual(unquote_git_path(naive), 'dir/quote"name.py')
        parsed = parse_name_status_text(quoted)
        self.assertEqual(parsed[0].dst, 'dir/quote"name.py')
        newline = 'A\t"dir/new\\nline.py"'
        self.assertEqual(unquote_git_path(newline.split("\t")[1]), "dir/new\nline.py")

    def test_unsafe_paths_stay_rejected_and_special_names_do_not(self):
        unsafe = (
            "/abs.py",
            "../x.py",
            "foo/../../x.py",
            "foo/./x.py",
            "foo//x.py",
            "C:/abs.py",
            "\\\\server\\share.py",
        )
        for path in unsafe:
            self.assertIsNotNone(repo_relative_path_issue(path), path)
            with self.assertRaises(MalformedCandidate):
                parse_candidate(
                    {
                        "project": "synth",
                        "target_file": path,
                        "patches": [
                            {"pr": 1, "mb": "a" * 40, "head": "b" * 40},
                            {"pr": 2, "mb": "c" * 40, "head": "d" * 40},
                        ],
                    },
                    0,
                )
        for path in SPECIAL_PATHS:
            self.assertIsNone(repo_relative_path_issue(path), path)
            parsed = parse_candidate(
                {
                    "project": "synth",
                    "target_file": path,
                    "patches": [
                        {"pr": 1, "mb": "a" * 40, "head": "b" * 40},
                        {"pr": 2, "mb": "c" * 40, "head": "d" * 40},
                    ],
                },
                0,
            )
            self.assertEqual(parsed.target_file, path)

    def test_special_names_survive_classification_not_only_gitio(self):
        with tempfile.TemporaryDirectory(prefix="hist-v8-paths-") as temp:
            _init(temp)
            for rel in (*SPECIAL_PATHS, "pkg/a.py", 'tests/test_檔案.py', 'tests/test_quote"name.py'):
                _write(temp, rel, _lines(30))
            base = _commit_all(temp, "base", "2024-01-01T00:00:00Z")
            for rel in (*SPECIAL_PATHS, "pkg/a.py", 'tests/test_檔案.py', 'tests/test_quote"name.py'):
                _write(temp, rel, _lines(30, {1: "HEAD-A"}))
            head_a = _commit_all(temp, "a", "2024-02-01T00:00:00Z")
            subprocess.check_call(["git", "-C", temp, "checkout", "-q", "--detach", base])
            for rel in (*SPECIAL_PATHS, "pkg/a.py", 'tests/test_檔案.py', 'tests/test_quote"name.py'):
                _write(temp, rel, _lines(30, {20: "HEAD-B"}))
            head_b = _commit_all(temp, "b", "2024-03-01T00:00:00Z")
            quoted = subprocess.check_output(
                ["git", "-C", temp, "diff", "--name-status", base, head_a],
                text=True,
            )
            self.assertIn('"dir/quote\\', quoted)
            self.assertNotIn("dir/new\nline.py", quoted)
            changes = name_status(temp, base, head_a)
            found = {change.dst for change in changes}
            for rel in SPECIAL_PATHS:
                self.assertIn(rel, found)
            for rel in SPECIAL_PATHS:
                items, excluded = classify_candidates(
                    temp,
                    [
                        parse_candidate(
                            {
                                "project": "synth",
                                "target_file": rel,
                                "patches": [
                                    {
                                        "pr": 1,
                                        "mb": base,
                                        "head": head_a,
                                        "committer_time": "2024-02-01T00:00:00Z",
                                        "merged_at": "2024-02-01T00:00:00Z",
                                    },
                                    {
                                        "pr": 2,
                                        "mb": base,
                                        "head": head_b,
                                        "committer_time": "2024-03-01T00:00:00Z",
                                        "merged_at": "2024-03-01T00:00:00Z",
                                    },
                                ],
                            },
                            0,
                        )
                    ],
                    "a" * 64,
                    DEV_WINDOW,
                    HELDOUT_WINDOW,
                )
                self.assertEqual(excluded, [], rel)
                self.assertEqual(items[0]["target_file"], rel)
                self.assertIn(items[0]["write_class"], ("A", "B"))
                self.assertIn('tests/test_檔案.py', items[0]["fixed_test_ids"])
                self.assertIn('tests/test_quote"name.py', items[0]["fixed_test_ids"])

    def test_rename_and_copy_survive_the_classified_item(self):
        with tempfile.TemporaryDirectory(prefix="hist-v8-rename-") as temp:
            _init(temp)
            _write(temp, "dir/old name.py", _lines(8))
            _write(temp, "src.py", b"copied-body\n")
            base = _commit_all(temp, "base", "2024-01-01T00:00:00Z")
            subprocess.check_call(
                ["git", "-C", temp, "mv", "--", "dir/old name.py", "dir/quote\"name.py"]
            )
            renamed = _commit_all(temp, "rename", "2024-02-01T00:00:00Z")
            subprocess.check_call(["git", "-C", temp, "checkout", "-q", "--detach", base])
            _write(temp, "dir/copied name.py", b"copied-body\n")
            copied = _commit_all(temp, "copy", "2024-03-01T00:00:00Z")
            rename_changes = name_status(temp, base, renamed)
            self.assertTrue(
                any(change.status == "R" and change.src == "dir/old name.py" and change.dst == 'dir/quote"name.py' for change in rename_changes)
            )
            copy_changes = name_status(temp, base, copied)
            self.assertTrue(
                any(change.status == "C" and change.src == "src.py" and change.dst == "dir/copied name.py" for change in copy_changes)
            )

            def pair(target: str, head: str) -> dict:
                return {
                    "project": "synth",
                    "target_file": target,
                    "patches": [
                        {"pr": 1, "mb": base, "head": head, "committer_time": "2024-02-01T00:00:00Z", "merged_at": "2024-02-01T00:00:00Z"},
                        {"pr": 2, "mb": base, "head": head, "committer_time": "2024-02-02T00:00:00Z", "merged_at": "2024-02-02T00:00:00Z"},
                    ],
                }

            renamed_items, renamed_excluded = classify_candidates(
                temp, [parse_candidate(pair('dir/quote"name.py', renamed), 0)], "b" * 64, DEV_WINDOW, HELDOUT_WINDOW
            )
            self.assertEqual(renamed_excluded, [])
            self.assertEqual(renamed_items[0]["target_file"], 'dir/quote"name.py')
            self.assertEqual(renamed_items[0]["write_class"], "D")
            self.assertIn("rename-from:dir/old name.py", renamed_items[0]["notes"])

            copied_items, copied_excluded = classify_candidates(
                temp, [parse_candidate(pair("dir/copied name.py", copied), 0)], "c" * 64, DEV_WINDOW, HELDOUT_WINDOW
            )
            self.assertEqual(copied_excluded, [])
            self.assertEqual(copied_items[0]["target_file"], "dir/copied name.py")
            self.assertIn("copy-from:src.py", copied_items[0]["notes"])


class SealAndIdentityTests(unittest.TestCase):
    def test_multiple_best_keeps_short_inputs_and_every_candidate(self):
        with tempfile.TemporaryDirectory(prefix="hist-v8-multi-") as temp:
            _init(temp)
            _write(temp, "f", b"x\n")
            subprocess.check_call(["git", "-C", temp, "add", "f"])
            tree = _git(temp, "write-tree")
            origin = _commit_tree(temp, tree, "O", [])
            base_one = _commit_tree(temp, tree, "M1", [origin])
            base_two = _commit_tree(temp, tree, "M2", [origin])
            tip_b = _commit_tree(temp, tree, "B", [base_one, base_two])
            tip_c = _commit_tree(temp, tree, "C", [base_two, base_one])
            _items, excluded = classify_candidates(
                temp,
                [
                    parse_candidate(
                        {
                            "project": "synth",
                            "target_file": "f",
                            "patches": [
                                {"pr": 1, "mb": tip_b[:12], "head": tip_b[:12], "committer_time": "2024-01-01T00:00:00Z"},
                                {"pr": 2, "mb": tip_c[:12], "head": tip_c[:12], "committer_time": "2024-01-02T00:00:00Z"},
                            ],
                        },
                        0,
                    )
                ],
                "d" * 64,
                DEV_WINDOW,
                HELDOUT_WINDOW,
            )
            self.assertEqual(excluded[0]["reason"], "multiple-best-common-bases")
            identities = excluded[0]["commit_identities"]
            self.assertEqual(sorted(identities["common_base_candidates"]), sorted([base_one, base_two]))
            self.assertEqual(len(identities["common_base_candidates"]), 2)
            self.assertIsNone(identities["common_base"])
            for entry in identities["inputs"]:
                self.assertEqual(len(entry["mb"]), 12)
                self.assertEqual(len(entry["head"]), 12)
                self.assertEqual(len(entry["mb_sha"]), 40)
                self.assertTrue(entry["mb_sha"].startswith(entry["mb"]))
                self.assertNotEqual(entry["mb"], entry["mb_sha"])


def _commit_tree(repo: str, tree: str, message: str, parents: list[str]) -> str:
    args = ["commit-tree", tree, "-m", message]
    for parent in parents:
        args.extend(["-p", parent])
    return _git(repo, *args)


class GlobalLeakageTests(unittest.TestCase):
    def test_per_batch_results_cannot_replace_the_global_component(self):
        dev = {"project": "p", "set": "dev", "prs": [1, 2], "target_file": "a.py", "grouping_codes": []}
        cross = {"project": "p", "set": "cross-window", "prs": [2, 3], "target_file": "b.py", "grouping_codes": []}
        later = {
            "project": "p",
            "set": "later-period-historical-holdout",
            "prs": [3, 4],
            "target_file": "c.py",
            "grouping_codes": [],
        }
        other_project = {
            "project": "q",
            "set": "later-period-historical-holdout",
            "prs": [1, 2],
            "target_file": "a.py",
            "grouping_codes": [],
        }
        rows = [dev, cross, later, other_project]
        local = []
        for row in rows:
            batch = [copy.deepcopy(row)]
            apply_holdout_leakage(batch)
            local.extend(batch)
        self.assertEqual(local[2]["grouping_codes"], [])
        self.assertEqual(local[2]["set"], "later-period-historical-holdout")
        glob = copy.deepcopy(rows)
        apply_holdout_leakage(glob)
        self.assertEqual(glob[2]["set"], "dev-cross-window")
        self.assertIn("shared-pr-component-leak", glob[2]["grouping_codes"])
        self.assertEqual(glob[3]["set"], "later-period-historical-holdout")
        self.assertEqual(glob[3]["grouping_codes"], [])
        self.assertNotEqual(
            [(row["set"], list(row["grouping_codes"])) for row in local],
            [(row["set"], list(row["grouping_codes"])) for row in glob],
        )

        dev_patch = {
            "project": "p",
            "set": "dev",
            "prs": [1],
            "target_file": "a.py",
            "grouping_codes": [],
            "patches": [
                {"pr": 1, "has_patch_bytes": True, "code_patch_sha256": "aaa", "patch_id": "p1", "commit_subject": "fix"}
            ],
        }
        later_patch = {
            "project": "p",
            "set": "later-period-historical-holdout",
            "prs": [9],
            "target_file": "a.py",
            "grouping_codes": [],
            "patches": [
                {
                    "pr": 9,
                    "has_patch_bytes": True,
                    "code_patch_sha256": "bbb",
                    "patch_id": "p1",
                    "commit_subject": "backport: fix",
                }
            ],
        }
        local_dev = [copy.deepcopy(dev_patch)]
        local_later = [copy.deepcopy(later_patch)]
        apply_holdout_leakage(local_dev)
        apply_holdout_leakage(local_later)
        self.assertEqual(local_later[0]["grouping_codes"], [])
        joined = [copy.deepcopy(dev_patch), copy.deepcopy(later_patch)]
        apply_holdout_leakage(joined)
        self.assertIn("backport-leak", joined[1]["grouping_codes"])
        self.assertEqual(joined[1]["set"], "dev-cross-window")

    def test_classify_across_batches_is_not_the_concatenation_of_local_runs(self):
        with tempfile.TemporaryDirectory(prefix="hist-v8-batch-") as temp:
            _init(temp)
            _write(temp, "pkg/a.py", _lines(40))
            base = _commit_all(temp, "base", "2024-01-01T00:00:00Z")

            def head(line: int, text: str, when: str) -> str:
                subprocess.check_call(["git", "-C", temp, "checkout", "-q", "--detach", base])
                _write(temp, "pkg/a.py", _lines(40, {line: text}))
                return _commit_all(temp, text, when)

            head_a = head(1, "AAA", "2024-02-01T00:00:00Z")
            head_b = head(20, "BBB", "2024-03-01T00:00:00Z")
            head_c = head(40, "CCC", "2024-04-01T00:00:00Z")

            def candidate(prs, heads, when: str) -> object:
                return parse_candidate(
                    {
                        "project": "synth",
                        "target_file": "pkg/a.py",
                        "patches": [
                            {
                                "pr": pr,
                                "mb": base,
                                "head": commit,
                                "committer_time": when,
                                "merged_at": when,
                            }
                            for pr, commit in zip(prs, heads)
                        ],
                    },
                    0,
                )

            dev_batch = [candidate((1, 2), (head_a, head_b), "2024-06-01T00:00:00Z")]
            hold_batch = [candidate((2, 3), (head_b, head_c), "2026-06-01T00:00:00Z")]
            dev_items, _dev_excluded = classify_candidates(
                temp, dev_batch, "e" * 64, DEV_WINDOW, HELDOUT_WINDOW
            )
            hold_items, _hold_excluded = classify_candidates(
                temp, hold_batch, "e" * 64, DEV_WINDOW, HELDOUT_WINDOW
            )
            self.assertEqual(hold_items[0]["set"], "later-period-historical-holdout")
            self.assertEqual(hold_items[0]["grouping_codes"], [])
            global_items, _global_excluded = classify_across_batches(
                temp, [dev_batch, hold_batch], "e" * 64, DEV_WINDOW, HELDOUT_WINDOW
            )
            by_prs = {tuple(item["prs"]): item for item in global_items}
            self.assertEqual(by_prs[(2, 3)]["set"], "dev-cross-window")
            self.assertIn("shared-pr-component-leak", by_prs[(2, 3)]["grouping_codes"])
            self.assertNotEqual(hold_items[0]["set"], by_prs[(2, 3)]["set"])
            self.assertEqual(dev_items[0]["set"], "dev")


class SealCliTests(unittest.TestCase):
    def test_summary_records_actual_argv_and_windows(self):
        from hist_v2_classify_v8.cli import main

        with tempfile.TemporaryDirectory(prefix="hist-v8-seal-") as temp:
            _init(temp)
            _write(temp, "pkg/a.py", b"x\n")
            _commit_all(temp, "base", "2024-01-01T00:00:00Z")
            candidates = os.path.join(temp, "empty.jsonl")
            Path(candidates).write_text("", encoding="utf-8")
            out = os.path.join(temp, "out")
            argv = [
                "--repo",
                temp,
                "--candidates",
                candidates,
                "--out-dir",
                out,
                "--dev-window",
                "2024-02-01..2024-02-28",
                "--heldout-window",
                "2026-03-01..2026-03-31",
            ]
            status = main(argv)
            self.assertEqual(status, 0)
            summary = json.loads(Path(out, "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["seal"]["argv"], argv)
            self.assertEqual(summary["seal"]["date_windows"]["dev"], ["2024-02-01", "2024-02-28"])
            self.assertEqual(
                summary["seal"]["date_windows"]["later_period_historical_holdout"],
                ["2026-03-01", "2026-03-31"],
            )
            self.assertEqual(summary["seal"]["dependencies"]["jsonschema"], "4.18.0")
            self.assertEqual(
                summary["canonical_design"],
                "research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/",
            )
            self.assertNotIn("HIST_BENCH_V2_PREREG_zh.md", summary["canonical_design"])


if __name__ == "__main__":
    unittest.main()
