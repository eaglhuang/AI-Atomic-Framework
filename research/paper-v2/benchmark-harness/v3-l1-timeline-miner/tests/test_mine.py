import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from _support import FakeTransport, django_15705_routes, scratch_dir, synth_commit

from v3_l1_miner import cli, store
from v3_l1_miner.fetch import fetch_pull
from v3_l1_miner.mine import HoldoutRefused, Miner

NOW = datetime(2026, 10, 31, tzinfo=timezone.utc)


def miner(t, out, repo="django/django", **kw):
    sleeps = []
    m = Miner(t, Path(out), repo, sleep=sleeps.append, now=lambda: NOW, **kw)
    return m, sleeps


class Mining(unittest.TestCase):
    def test_holdout_and_tmp_guards(self):
        with scratch_dir() as d:
            for repo in ("pallets/flask", "psf/requests"):
                with self.assertRaises(HoldoutRefused):
                    miner(FakeTransport({}), d, repo)
            m, _ = miner(FakeTransport({}), d / "ok", "pallets/flask", allow_holdout=True)
            self.assertTrue(m.out_dir.exists())
        with self.assertRaises(ValueError):
            Miner(FakeTransport({}), Path("/tmp/v3-miner-should-not-exist"), "django/django")
        self.assertFalse(Path("/tmp/v3-miner-should-not-exist").exists())

    def test_resume_skips_done_and_repairs_partial_line(self):
        with scratch_dir() as d:
            t = FakeTransport(django_15705_routes())
            m, _ = miner(t, d)
            man = m.run([15705, 99999])
            self.assertEqual(man["records"], 1)
            self.assertEqual(man["this_run"]["errors"], 1)
            err = store.load(d / "errors.jsonl")
            self.assertEqual(err[0]["number"], 99999)
            self.assertEqual(err[0]["status"], 404)
            with open(d / "timelines.jsonl", "a") as fh:
                fh.write('{"partial": ')  # simulated kill mid-write
            t2 = FakeTransport(django_15705_routes())
            m2, _ = miner(t2, d)
            man2 = m2.run([15705])
            self.assertEqual(t2.log, [])  # nothing refetched
            self.assertEqual(man2["records"], 1)
            self.assertEqual(man2["this_run"]["skipped"], 1)
            self.assertEqual(man2["timelines_sha256"], store.sha256_file(d / "timelines.jsonl"))

    def test_rate_limit_backoff_then_success(self):
        routes = django_15705_routes()
        routes["rate_limit"] = {"resources": {"core": {"remaining": 0, "reset": int(NOW.timestamp()) + 100}}}
        t = FakeTransport(routes, fail={"repos/django/django/pulls/15705": [403]})
        with scratch_dir() as d:
            m, sleeps = miner(t, d)
            man = m.run([15705])
        self.assertEqual(man["records"], 1)
        self.assertEqual(sleeps, [105])

    def test_commit_pagination_and_cap(self):
        base = "repos/o/r/pulls/7"
        commits = [synth_commit(i, f"2024-01-01T{(i // 60) % 24:02d}:{i % 60:02d}:00Z") for i in range(150)]
        routes = {base: {"created_at": "2024-01-02T00:00:00Z", "commits": 150, "base": {}, "head": {}},
                  f"{base}/commits?per_page=100&page=1": commits[:100],
                  f"{base}/commits?per_page=100&page=2": commits[100:],
                  f"{base}/files?per_page=100&page=1": []}
        for cm in commits:
            routes[f"repos/o/r/commits/{cm['sha']}"] = {"files": []}
        raw = fetch_pull(FakeTransport(routes), "o/r", 7)
        self.assertEqual(len(raw.commits), 150)
        self.assertEqual(raw.calls, 1 + 2 + 1 + 150)

    def test_cli_validate_and_rederive(self):
        with scratch_dir() as d:
            m, _ = miner(FakeTransport(django_15705_routes()), d)
            m.run([15705])
            self.assertEqual(cli.main(["validate", "--in", str(d / "timelines.jsonl")]), 0)
            self.assertEqual(cli.main(["rederive", "--in", str(d / "timelines.jsonl"), "--out", str(d / "re.jsonl")]), 0)
            a = store.load(d / "timelines.jsonl")[0]["derived"]
            b = store.load(d / "re.jsonl")[0]["derived"]
            self.assertEqual(a, b)
            rec = store.load(d / "timelines.jsonl")[0]
            rec["raw"]["commits"][1]["files"] = []  # merge commit must have null files
            (d / "bad.jsonl").write_text(json.dumps(rec) + "\n")
            self.assertEqual(cli.main(["validate", "--in", str(d / "bad.jsonl")]), 1)

    def test_cli_refuses_holdout(self):
        self.assertEqual(cli.main(["mine", "--repo", "psf/requests", "--numbers", "1", "--out", "unused"]), 3)


if __name__ == "__main__":
    unittest.main()
