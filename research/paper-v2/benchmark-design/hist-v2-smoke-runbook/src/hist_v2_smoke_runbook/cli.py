"""Smoke CLI. Pin failures and forbidden stages create no run directory."""

import argparse
import json
import os
import sys
from pathlib import Path

from .pins import load_pins
from .plan import build_plan
from .preflight import check_pins
from .sample import load_items, sample_dev
from .stage import approval_problem, pilot_overlay


def repo_root() -> Path:
    env = os.environ.get("HIST_V2_REPO_ROOT")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "atm.mjs").is_file():
            return parent
    raise RuntimeError("ATM repository root was not found")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="HIST-v2 trial-only smoke preflight. Formal runs stay closed.")
    parser.add_argument("--pins", type=Path)
    parser.add_argument("--items", type=Path)
    parser.add_argument("--binding", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--date")
    parser.add_argument("--stage", default="check")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--repo", type=Path)
    args = parser.parse_args(argv)
    pins = load_pins(args.pins)
    stage = args.stage.strip().lower()
    if stage in pins["forbidden_stages"]:
        print(f"refusing stage {stage}; no run directory created", file=sys.stderr)
        return 2
    failures = check_pins(args.repo or repo_root(), pins)
    if failures:
        for failure in failures:
            print(f"PIN_MISMATCH {failure}", file=sys.stderr)
        print("no run directory created", file=sys.stderr)
        return 1
    if stage == "pilot":
        problem = approval_problem(pins, stage)
        if problem:
            print(problem, file=sys.stderr)
            return 3
        pins, problems = pilot_overlay(pins)
        if problems:
            for problem in problems:
                print(f"PILOT_MATRIX {problem}", file=sys.stderr)
            print("no run directory created", file=sys.stderr)
            return 1
    if not args.execute:
        payload = {
            "preflight": "ok",
            "executed": False,
            "runs_started": 0,
            "formal_run": False,
            "trial_only": True,
            "claims_benchmark_wins": False,
            "stage": stage,
            "paper_results": False,
        }
        if args.items:
            loaded, errors = load_items(args.items)
            sample = sample_dev(loaded, pins)
            sample["errors"] = errors + sample["errors"]
            if sample["errors"]:
                for error in sample["errors"]:
                    print(f"SAMPLE {error}", file=sys.stderr)
                print("no run directory created", file=sys.stderr)
                return 2
            payload["sample"] = sample
            payload["plan"] = build_plan(sample["selected"], pins)
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    if stage != "pilot" and os.environ.get(pins["approval_env"]) != pins["approval_value"]:
        print("author approval missing; no run directory created", file=sys.stderr)
        return 3
    if stage not in {"check", "smoke", "pilot"}:
        print(f"refusing stage {stage}; no run directory created", file=sys.stderr)
        return 2
    from .replay import execute_smoke

    date = args.date or "2026-10-15"
    dest = args.out
    if dest is None:
        suffix = "hist-v2-pilot" if stage == "pilot" else "hist-v2-smoke"
        dest = (args.repo or repo_root()) / "research/paper-v2/benchmark-trials" / f"{date}-{suffix}"
    return execute_smoke(
        repo=args.repo or repo_root(),
        pins=pins,
        items_path=args.items,
        binding_dir=args.binding,
        dest=dest,
        date=date,
    )


if __name__ == "__main__":
    raise SystemExit(main())
