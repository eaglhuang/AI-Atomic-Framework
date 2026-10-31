"""CLI: mine | rederive | validate. Mining only fetches public PR metadata."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import store
from .derive import derive
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
    r = sub.add_parser("rederive", help="recompute `derived` from `raw` (offline)")
    r.add_argument("--in", dest="inp", required=True)
    r.add_argument("--out", required=True)
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
                          log=lambda s: print(s, file=sys.stderr))
        except (HoldoutRefused, ValueError) as exc:
            print(str(exc), file=sys.stderr)
            return 3
        manifest = miner.run(nums)
        print(json.dumps(manifest, indent=1, sort_keys=True))
        return 0
    if args.cmd == "rederive":
        out = Path(args.out)
        if out.exists():
            print("refusing to overwrite", file=sys.stderr)
            return 2
        for rec in store.load(Path(args.inp)):
            rec["derived"] = derive(rec["raw"])
            store.append(out, rec)
        return 0
    if args.cmd == "validate":
        recs = store.load(Path(args.inp))
        bad = 0
        flags: dict[str, int] = {}
        for rec in recs:
            errs = validate_errors(rec)
            if errs:
                bad += 1
                print(f"{rec.get('raw', {}).get('number')}: {'; '.join(errs)}", file=sys.stderr)
            for f in rec.get("derived", {}).get("flags", []):
                flags[f] = flags.get(f, 0) + 1
        print(json.dumps({"records": len(recs), "invalid": bad, "flag_counts": flags}, sort_keys=True))
        return 1 if bad else 0
    return 2
