"""CLI: list-window | mine | rederive | validate. Only public PR metadata is fetched."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import sensitivity, store
from .derive import derive
from .listing import ListingError, list_window
from .summary import summarize
from .mine import HoldoutRefused, Miner
from .transport import GhTransport
from .validate import errors as validate_errors


def _numbers(args) -> list[int]:
    nums: list[int] = []
    if args.numbers:
        nums.extend(int(x) for x in args.numbers.split(",") if x.strip())
    if args.snapshot:
        for line in Path(args.snapshot).read_text(encoding="utf-8").splitlines():
            if line.strip():
                nums.append(int(json.loads(line)["number"]))
    seen: set[int] = set()
    ordered = [n for n in nums if not (n in seen or seen.add(n))]
    return ordered[: args.limit] if args.limit else ordered


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="v3_l1_miner")
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("mine", help="fetch PR commit timelines (resumable)")
    m.add_argument("--repo", required=True, help="owner/name, e.g. django/django")
    m.add_argument("--snapshot", help="JSONL with a `number` field per PR")
    m.add_argument("--numbers", help="comma-separated PR numbers")
    m.add_argument("--limit", type=int, default=0)
    m.add_argument("--out", required=True)
    m.add_argument("--max-calls", type=int, default=None)
    m.add_argument("--allow-holdout", action="store_true")
    m.add_argument("--events", action="store_true", help="also fetch the issue timeline (force-push events)")
    lw = sub.add_parser("list-window", help="list PRs merged in [since, until) via search API")
    lw.add_argument("--repo", required=True)
    lw.add_argument("--since", required=True, help="YYYY-MM-DDTHH:MM:SSZ (inclusive)")
    lw.add_argument("--until", required=True, help="YYYY-MM-DDTHH:MM:SSZ (exclusive)")
    lw.add_argument("--out", required=True, help="snapshot JSONL; <out>.listing.json gets the query metadata")
    lw.add_argument("--allow-holdout", action="store_true")
    r = sub.add_parser("rederive", help="recompute `derived` from `raw` and apply rule A (offline)")
    r.add_argument("--in", dest="inp", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--summary", help="write a descriptive summary JSON here")
    v = sub.add_parser("validate", help="schema-check a timelines.jsonl and print a summary")
    v.add_argument("--in", dest="inp", required=True)
    args = p.parse_args(argv)

    if args.cmd == "mine":
        nums = _numbers(args)
        if not nums:
            print("no PR numbers given", file=sys.stderr)
            return 2
        try:
            miner = Miner(GhTransport(), Path(args.out), args.repo,
                          allow_holdout=args.allow_holdout, max_calls=args.max_calls,
                          events=args.events,
                          log=lambda s: print(s, file=sys.stderr))
        except (HoldoutRefused, ValueError) as exc:
            print(str(exc), file=sys.stderr)
            return 3
        manifest = miner.run(nums)
        print(json.dumps(manifest, indent=1, sort_keys=True))
        return 0
    if args.cmd == "list-window":
        out = Path(args.out)
        meta_path = out.with_name(out.name + ".listing.json")
        if out.exists() or meta_path.exists():
            print("refusing to overwrite", file=sys.stderr)
            return 2
        try:
            rows, meta = list_window(GhTransport(), args.repo, args.since, args.until,
                                     allow_holdout=args.allow_holdout)
        except (HoldoutRefused, ListingError) as exc:
            print(str(exc), file=sys.stderr)
            return 3
        out.parent.mkdir(parents=True, exist_ok=True)
        for row in rows:
            store.append(out, row)
        meta["snapshot_sha256"] = store.sha256_file(out) if rows else None
        store.write_atomic(meta_path, json.dumps(meta, indent=1, sort_keys=True) + "\n")
        print(json.dumps(meta, indent=1, sort_keys=True))
        return 0
    if args.cmd == "rederive":
        out = Path(args.out)
        if out.exists():
            print("refusing to overwrite", file=sys.stderr)
            return 2
        recs = store.load(Path(args.inp))
        for rec in recs:
            rec["derived"] = derive(rec["raw"])
        meta = sensitivity.apply(recs)
        for rec in recs:
            store.append(out, rec)
        if args.summary:
            store.write_atomic(Path(args.summary), json.dumps(summarize(recs, meta), indent=1, sort_keys=True) + "\n")
        print(json.dumps(meta, sort_keys=True))
        return 0
    if args.cmd == "validate":
        recs = store.load(Path(args.inp))
        bad = 0
        flags: dict[str, int] = {}
        excluded = 0
        for rec in recs:
            if rec.get("derived", {}).get("timeline_ok") is False:
                excluded += 1
            errs = validate_errors(rec)
            if errs:
                bad += 1
                print(f"{rec.get('raw', {}).get('number')}: {'; '.join(errs)}", file=sys.stderr)
            for f in rec.get("derived", {}).get("flags", []):
                flags[f] = flags.get(f, 0) + 1
        print(json.dumps({"records": len(recs), "invalid": bad, "flag_counts": flags,
                          "rule_a_excluded": excluded}, sort_keys=True))
        return 1 if bad else 0
    return 2
