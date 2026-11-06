"""Exclusion rule A (author decision 2026-10-31), sensitivity imputation, window listing."""

import unittest
from datetime import datetime, timezone
from urllib.parse import quote

from _support import FakeTransport, django_15705_routes, synth_commit

from test_derive import c, f, rec
from v3_l1_miner import sensitivity
from v3_l1_miner.derive import derive
from v3_l1_miner.fetch import fetch_pull, normalize
from v3_l1_miner.listing import ListingError, list_window, query_for
from v3_l1_miner.mine import HoldoutRefused, build_record
from v3_l1_miner.summary import summarize
from v3_l1_miner.validate import errors

NOW = datetime(2026, 10, 31, tzinfo=timezone.utc)


def wrap(raw, number):
    raw = dict(raw, repo="o/r", number=number, api_calls=1)
    for i, cm in enumerate(raw["commits"]):
        cm["sha"] = f"{number * 100 + i:040x}"
    return {"schema": "atm.paper-v3.l1-timeline.v1", "miner_version": "2", "fetched_at": "2026-10-31T00:00:00Z",
            "raw": raw, "derived": derive(raw)}


CLEAN_1H = rec([c(0, "2024-01-01T11:00:00Z", [f("a")])], pull_files=[f("a")])            # dev 3600
CLEAN_3H = rec([c(0, "2024-01-01T09:00:00Z", [f("a")])], pull_files=[f("a")])            # dev 10800
LATE = rec([c(0, "2024-01-02T10:00:00Z", [f("a")])], pull_files=[f("a")])                # start after submit
REORDERED = rec([c(0, "2024-01-01T11:00:00Z", [f("a")]), c(1, "2024-01-01T08:00:00Z", [f("b")])],
                pull_files=[f("a"), f("b")])
MERGE_ONLY = rec([c(0, "2024-01-01T10:00:00Z", None, merge=True)])


class RuleA(unittest.TestCase):
    def test_reasons_per_record(self):
        self.assertTrue(derive(CLEAN_1H)["timeline_ok"])
        late = derive(LATE)
        self.assertFalse(late["timeline_ok"])
        self.assertEqual(late["exclusion_reasons"], ["start-after-submit", "negative-dev-seconds"])
        self.assertEqual(derive(REORDERED)["exclusion_reasons"], ["author-order-differs"])
        self.assertEqual(derive(MERGE_ONLY)["exclusion_reasons"], ["no-own-commits"])

    def test_force_push_is_flag_not_exclusion(self):
        r = dict(CLEAN_1H, force_pushes=[{"at": "2024-01-01T13:00:00Z", "commit_id": None}])
        d = derive(r)
        self.assertIn("force-pushed-after-submit", d["flags"])
        self.assertTrue(d["timeline_ok"])
        self.assertEqual(d["n_force_pushes"], 1)
        self.assertIsNone(derive(CLEAN_1H)["n_force_pushes"])

    def test_imputation_uses_median_of_clean_and_keeps_records(self):
        recs = [wrap(r, i + 1) for i, r in enumerate([CLEAN_1H, CLEAN_3H, LATE, REORDERED, MERGE_ONLY])]
        meta = sensitivity.apply(recs)
        self.assertEqual(len(recs), 5)
        self.assertEqual(meta["timeline_ok"], 2)
        self.assertEqual(meta["excluded"], 3)
        self.assertEqual(meta["exclusion_rate"], 0.6)
        self.assertEqual(meta["imputation_median_dev_seconds"], 7200)
        self.assertEqual(recs[2]["derived"]["t_start_imputed"], "2024-01-01T10:00:00Z")
        self.assertEqual(recs[2]["derived"]["t_start"], "2024-01-02T10:00:00Z")  # original kept
        self.assertEqual(recs[0]["derived"]["t_start_sens"], recs[0]["derived"]["t_start"])
        self.assertIsNone(recs[0]["derived"]["t_start_imputed"])
        for r in recs:
            self.assertEqual(errors(r), [], r["raw"]["number"])
        s = summarize(recs, meta)
        self.assertEqual(s["records"], 5)
        self.assertEqual(s["claim_sets_timeline_ok"]["s1_equals_s2_rate"], 1.0)
        self.assertEqual(s["dev_seconds_timeline_ok"]["median"], 7200)

    def test_validator_catches_inconsistent_rule_a(self):
        r = wrap(LATE, 9)
        sensitivity.apply([r])
        r["derived"]["timeline_ok"] = True
        self.assertIn("timeline_ok iff no exclusion_reasons", errors(r))

    def test_events_fetch_records_force_pushes(self):
        routes = django_15705_routes()
        routes["repos/django/django/issues/15705/timeline?per_page=100&page=1"] = [
            {"event": "committed"}, {"event": "head_ref_force_pushed", "created_at": "2022-05-19T00:00:00Z",
                                     "commit_id": "f" * 40}]
        t = FakeTransport(routes)
        raw = fetch_pull(t, "django/django", 15705, events=True)
        self.assertEqual(raw.calls, 6)
        rec_ = build_record(normalize(raw), "2026-10-31T00:00:00Z")
        self.assertEqual(rec_["raw"]["force_pushes"], [{"at": "2022-05-19T00:00:00Z", "commit_id": "f" * 40}])
        self.assertIn("force-pushed-after-submit", rec_["derived"]["flags"])
        self.assertEqual(errors(rec_), [])


def item(n, merged):
    return {"number": n, "title": f"t{n}", "user": {"login": "u"}, "created_at": "2026-08-30T00:00:00Z",
            "closed_at": merged, "html_url": f"https://github.com/o/r/pull/{n}", "pull_request": {"merged_at": merged}}


class Listing(unittest.TestCase):
    SINCE, UNTIL = "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"

    def path(self, page):
        q = query_for("o/r", self.SINCE, self.UNTIL)
        return f"search/issues?q={quote(q)}&sort=created&order=asc&per_page=100&page={page}"

    def test_query_and_half_open_window(self):
        self.assertEqual(query_for("o/r", self.SINCE, self.UNTIL),
                         "repo:o/r is:pr is:merged merged:2026-09-01T00:00:00Z..2026-09-30T23:59:59Z")
        items = [item(3, "2026-09-01T00:00:00Z"), item(1, "2026-09-30T23:59:59Z"),
                 item(2, "2026-10-01T00:00:00Z"), item(1, "2026-09-30T23:59:59Z")]
        t = FakeTransport({self.path(1): {"total_count": 4, "incomplete_results": False, "items": items}})
        rows, meta = list_window(t, "o/r", self.SINCE, self.UNTIL, now=lambda: NOW)
        self.assertEqual([r["number"] for r in rows], [1, 3])
        self.assertEqual(meta["dropped_outside_window"], [2])
        self.assertEqual(meta["listed_at"], "2026-10-31T00:00:00Z")
        self.assertEqual(meta["api_calls"], 1)

    def test_pagination_incomplete_and_guards(self):
        page1 = [item(i, "2026-09-10T00:00:00Z") for i in range(100)]
        page2 = [item(100 + i, "2026-09-10T00:00:00Z") for i in range(5)]
        t = FakeTransport({self.path(1): {"total_count": 105, "items": page1},
                           self.path(2): {"total_count": 105, "items": page2}})
        rows, meta = list_window(t, "o/r", self.SINCE, self.UNTIL, now=lambda: NOW)
        self.assertEqual(len(rows), 105)
        self.assertEqual(meta["api_calls"], 2)
        bad = FakeTransport({self.path(1): {"total_count": 1, "incomplete_results": True, "items": page1[:1]}})
        with self.assertRaises(ListingError):
            list_window(bad, "o/r", self.SINCE, self.UNTIL)
        with self.assertRaises(HoldoutRefused):
            list_window(FakeTransport({}), "pallets/flask", self.SINCE, self.UNTIL)
        with self.assertRaises(ListingError):
            list_window(FakeTransport({}), "o/r", self.UNTIL, self.SINCE)


if __name__ == "__main__":
    unittest.main()
