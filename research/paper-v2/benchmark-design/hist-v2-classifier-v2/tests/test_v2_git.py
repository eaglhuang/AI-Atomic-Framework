"""Git-backed checks for the true common ancestor and patch equivalence."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from hist_v2_classify_v2.gitio import best_common_ancestors, stable_patch_id  # noqa: E402
from hist_v2_classify_v2.parameters import DEV_WINDOW, HELDOUT_WINDOW  # noqa: E402
from hist_v2_classify_v2.pipeline import classify_candidates, parse_candidate  # noqa: E402


def _init(path: str) -> str:
    subprocess.check_call(["git", "init", "-q", "-b", "main", path])
    subprocess.check_call(["git", "-C", path, "config", "user.email", "hist-v2@example.com"])
    subprocess.check_call(["git", "-C", path, "config", "user.name", "hist-v2"])
    subprocess.check_call(["git", "-C", path, "config", "commit.gpgsign", "false"])
    with open(os.path.join(path, "f"), "w", encoding="utf-8") as handle:
        handle.write("x\n")
    subprocess.check_call(["git", "-C", path, "add", "f"])
    return subprocess.check_output(["git", "-C", path, "write-tree"], text=True).strip()


def _commit(path: str, tree: str, message: str, parents: list[str]) -> str:
    args = ["git", "-C", path, "commit-tree", tree, "-m", message]
    for parent in parents:
        args.extend(["-p", parent])
    return subprocess.check_output(args, text=True).strip()


class CommonAncestorTests(unittest.TestCase):
    def test_plain_merge_base_is_not_the_common_ancestor(self):
        with tempfile.TemporaryDirectory(prefix="hist-v2-base-") as temp:
            tree = _init(temp)
            origin = _commit(temp, tree, "O", [])
            base_one = _commit(temp, tree, "M1", [origin])
            base_two = _commit(temp, tree, "M2", [origin])
            tip_b = _commit(temp, tree, "B", [base_one, base_two])
            tip_c = _commit(temp, tree, "C", [base_two, base_one])
            tip_a = _commit(temp, tree, "A", [base_two])
            plain = subprocess.check_output(
                ["git", "-C", temp, "merge-base", tip_b, tip_c, tip_a],
                text=True,
            ).strip()
            self.assertEqual(plain, base_one)
            ancestor = subprocess.call(
                ["git", "-C", temp, "merge-base", "--is-ancestor", plain, tip_a]
            )
            self.assertEqual(ancestor, 1)
            found = best_common_ancestors(temp, [tip_b, tip_c, tip_a])
            self.assertEqual(found, [base_two])

    def test_multiple_best_bases_are_excluded(self):
        with tempfile.TemporaryDirectory(prefix="hist-v2-multi-") as temp:
            tree = _init(temp)
            origin = _commit(temp, tree, "O", [])
            base_one = _commit(temp, tree, "M1", [origin])
            base_two = _commit(temp, tree, "M2", [origin])
            tip_b = _commit(temp, tree, "B", [base_one, base_two])
            tip_c = _commit(temp, tree, "C", [base_two, base_one])
            found = best_common_ancestors(temp, [tip_b, tip_c])
            self.assertEqual(sorted(found), sorted([base_one, base_two]))
            items, excluded = classify_candidates(
                temp,
                [
                    parse_candidate(
                        {
                            "project": "synth",
                            "target_file": "f",
                            "patches": [
                                {"pr": 1, "mb": tip_b, "head": tip_b, "committer_time": "2024-01-01T00:00:00Z"},
                                {"pr": 2, "mb": tip_c, "head": tip_c, "committer_time": "2024-01-02T00:00:00Z"},
                            ],
                        },
                        0,
                    )
                ],
                "a" * 64,
                DEV_WINDOW,
                HELDOUT_WINDOW,
            )
            self.assertEqual(items, [])
            self.assertEqual(excluded[0]["reason"], "multiple-best-common-bases")
            self.assertEqual(
                sorted(excluded[0]["commit_identities"]["common_base_candidates"]),
                sorted([base_one, base_two]),
            )


class PatchIdTests(unittest.TestCase):
    def test_shifted_cherry_pick_shares_patch_id_but_not_diff_bytes(self):
        with tempfile.TemporaryDirectory(prefix="hist-v2-pick-") as temp:
            subprocess.check_call(["git", "init", "-q", "-b", "main", temp])
            subprocess.check_call(["git", "-C", temp, "config", "user.email", "hist-v2@example.com"])
            subprocess.check_call(["git", "-C", temp, "config", "user.name", "hist-v2"])
            subprocess.check_call(["git", "-C", temp, "config", "commit.gpgsign", "false"])
            path = os.path.join(temp, "pkg.py")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("".join(f"L{i:02d}\n" for i in range(1, 21)))
            subprocess.check_call(["git", "-C", temp, "add", "pkg.py"])
            subprocess.check_call(["git", "-C", temp, "commit", "-q", "-m", "base"])
            base = subprocess.check_output(["git", "-C", temp, "rev-parse", "HEAD"], text=True).strip()
            with open(path, "w", encoding="utf-8") as handle:
                rows = [f"L{i:02d}\n" for i in range(1, 21)]
                rows[4] = "EDIT\n"
                handle.write("".join(rows))
            subprocess.check_call(["git", "-C", temp, "commit", "-q", "-am", "edit"])
            edited = subprocess.check_output(["git", "-C", temp, "rev-parse", "HEAD"], text=True).strip()
            subprocess.check_call(["git", "-C", temp, "checkout", "-q", "-b", "later", base])
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("PAD\n" + "".join(f"L{i:02d}\n" for i in range(1, 21)))
            subprocess.check_call(["git", "-C", temp, "commit", "-q", "-am", "pad"])
            subprocess.check_call(["git", "-C", temp, "cherry-pick", edited])
            picked = subprocess.check_output(["git", "-C", temp, "rev-parse", "HEAD"], text=True).strip()
            parent = subprocess.check_output(["git", "-C", temp, "rev-parse", "HEAD^"], text=True).strip()
            original = subprocess.check_output(["git", "-C", temp, "diff", base, edited, "--", "pkg.py"])
            shifted = subprocess.check_output(["git", "-C", temp, "diff", parent, picked, "--", "pkg.py"])
            self.assertNotEqual(original, shifted)
            self.assertEqual(stable_patch_id(original), stable_patch_id(shifted))
            self.assertTrue(stable_patch_id(original))


if __name__ == "__main__":
    unittest.main()
