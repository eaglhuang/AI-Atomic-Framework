import unittest

import _support  # noqa: F401  (puts src/ on sys.path)

from v3_l1_miner.derive import derive


def rec(commits, created="2024-01-01T12:00:00Z", pull_files=None, reported=None):
    return {"created_at": created, "commits": commits,
            "pull_files": pull_files if pull_files is not None else [],
            "n_commits_reported": reported if reported is not None else len(commits)}


def c(i, author, files, committer=None, merge=False):
    return {"index": i, "sha": f"{i:040x}", "author_date": author, "committer_date": committer or author,
            "parents": ["a" * 40, "b" * 40] if merge else ["a" * 40], "is_merge": merge,
            "files": None if merge else files}


def f(path, a=1, d=0, prev=None, status="modified"):
    e = {"path": path, "status": status, "additions": a, "deletions": d}
    if prev:
        e["previous_path"] = prev
    return e


class Derive(unittest.TestCase):
    def test_t_write_first_touch_and_late_files(self):
        r = rec([c(0, "2024-01-01T10:00:00Z", [f("a/x.py", 3, 1)]),
                 c(1, "2024-01-01T11:00:00Z", [f("a/x.py", 1), f("b/y.py", 2)])],
                pull_files=[f("a/x.py"), f("b/y.py")])
        d = derive(r)
        self.assertEqual(d["s1_files"], ["a/x.py"])
        self.assertEqual(d["t_write"], {"a/x.py": "2024-01-01T10:00:00Z", "b/y.py": "2024-01-01T11:00:00Z"})
        self.assertEqual([x["cum_lines"] for x in d["line_timeline"]], [4, 7])
        self.assertEqual(d["dev_seconds"], 7200)
        self.assertEqual(d["flags"], [])

    def test_rename_touches_both_paths(self):
        r = rec([c(0, "2024-01-01T10:00:00Z", [f("new/m.py", prev="old/m.py", status="renamed")])],
                pull_files=[f("new/m.py", prev="old/m.py", status="renamed")])
        d = derive(r)
        self.assertEqual(d["s1_files"], ["new/m.py", "old/m.py"])
        self.assertEqual(d["s3_dirs"], ["new", "old"])
        self.assertEqual(d["s2_files"], ["new/m.py", "old/m.py"])

    def test_root_file_dir_is_dot(self):
        d = derive(rec([c(0, "2024-01-01T10:00:00Z", [f("setup.py")])], pull_files=[f("setup.py")]))
        self.assertEqual(d["s3_dirs"], ["."])

    def test_reordered_history_and_after_submit(self):
        r = rec([c(0, "2024-01-02T10:00:00Z", [f("x")], committer="2024-01-02T10:00:00Z"),
                 c(1, "2024-01-01T09:00:00Z", [f("y")])],
                created="2024-01-01T12:00:00Z", pull_files=[f("x"), f("y")], reported=3)
        flags = derive(r)["flags"]
        for want in ("author-order-differs", "start-after-submit", "committed-after-submit",
                     "commit-count-mismatch"):
            self.assertIn(want, flags)

    def test_merge_only_and_truncation_flags(self):
        d = derive(rec([c(0, "2024-01-01T10:00:00Z", None, merge=True)]))
        self.assertEqual(d["flags"], ["no-own-commits"])
        self.assertIsNone(d["t_start"])
        r = rec([c(0, "2024-01-01T10:00:00Z", [f("x")])], pull_files=[f("x")], reported=300)
        r["pull_files_truncated"] = True
        r["commit_files_truncated"] = ["0" * 40]
        flags = derive(r)["flags"]
        for want in ("commits-truncated", "pull-files-truncated", "commit-files-truncated"):
            self.assertIn(want, flags)

    def test_s1_outside_final_diff_is_flagged(self):
        r = rec([c(0, "2024-01-01T10:00:00Z", [f("tmp_debug.py")]),
                 c(1, "2024-01-01T10:30:00Z", [f("tmp_debug.py", 0, 1, status="removed"), f("real.py")])],
                pull_files=[f("real.py")])
        self.assertIn("s1-not-subset-of-s2", derive(r)["flags"])

    def test_empty_first_commit(self):
        d = derive(rec([c(0, "2024-01-01T10:00:00Z", []), c(1, "2024-01-01T11:00:00Z", [f("z")])],
                       pull_files=[f("z")]))
        self.assertIn("first-commit-empty", d["flags"])
        self.assertEqual(d["s1_files"], [])


if __name__ == "__main__":
    unittest.main()
