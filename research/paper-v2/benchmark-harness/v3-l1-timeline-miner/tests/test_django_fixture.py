"""Real GitHub responses for django/django#15705 (3 commits, one is a merge of main)."""

import unittest

from _support import FakeTransport, django_15705_routes

from v3_l1_miner.fetch import fetch_pull, normalize
from v3_l1_miner.mine import build_record
from v3_l1_miner.validate import errors

MERGE_SHA = "5b07614242c478dccd0cf6c007e0e89694b9b9dc"


class DjangoFixture(unittest.TestCase):
    def setUp(self):
        self.t = FakeTransport(django_15705_routes())
        raw = fetch_pull(self.t, "django/django", 15705)
        self.calls = raw.calls
        self.rec = build_record(normalize(raw), "2026-10-31T00:00:00Z")

    def test_merge_commit_files_not_fetched(self):
        self.assertFalse(any(MERGE_SHA in p for p in self.t.log))
        merge = [c for c in self.rec["raw"]["commits"] if c["is_merge"]]
        self.assertEqual([c["sha"] for c in merge], [MERGE_SHA])
        self.assertIsNone(merge[0]["files"])
        self.assertEqual(self.calls, 5)

    def test_derived_quantities(self):
        d = self.rec["derived"]
        self.assertEqual(d["t_start"], "2022-05-18T07:13:38Z")
        self.assertEqual(d["t_submit"], "2022-05-18T07:19:26Z")
        self.assertEqual(d["dev_seconds"], 348)
        self.assertEqual(d["s1_files"], ["django/db/models/query.py"])
        self.assertEqual(d["s2_files"], ["django/db/models/query.py"])
        self.assertEqual(d["s3_dirs"], ["django/db/models"])
        self.assertEqual(d["t_write"], {"django/db/models/query.py": "2022-05-18T07:13:38Z"})
        self.assertEqual([x["cum_lines"] for x in d["line_timeline"]], [4, 8])
        self.assertEqual(d["n_merge_commits"], 1)
        self.assertEqual(d["t_submit_alt"], "2024-01-01T17:44:26Z")
        self.assertIn("has-merge-commits", d["flags"])
        self.assertIn("committed-after-submit", d["flags"])
        self.assertNotIn("commit-count-mismatch", d["flags"])

    def test_record_validates(self):
        self.assertEqual(errors(self.rec), [])
        broken = dict(self.rec, derived=dict(self.rec["derived"], t_submit="2020-01-01T00:00:00Z"))
        self.assertIn("derived.t_submit == created_at", errors(broken))


if __name__ == "__main__":
    unittest.main()
