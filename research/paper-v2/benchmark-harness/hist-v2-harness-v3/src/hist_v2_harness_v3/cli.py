"""Run one catalog fixture. Formal smoke, pilot, main, and held-out runs stay closed."""

import argparse
import json

from .catalog import fixture_by_id
from .driver import run_fixture
from .limits import ARMS


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one HIST-v2 harness fixture. Formal runs need separate approval.")
    parser.add_argument("fixture", help="Catalog fixture id. This command refuses smoke, pilot, main, and held-out.")
    parser.add_argument("--arm", required=True, choices=ARMS)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--order", choices=("forward", "reverse"), default="forward")
    parser.add_argument("--inter-arrival-ms", type=int, default=0)
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args(argv)
    blocked = {"smoke", "pilot", "main", "held-out", "heldout"}
    if args.fixture in blocked or args.fixture.startswith("smoke") or args.fixture.startswith("pilot"):
        parser.error("formal runs need separate approval; this command only runs one catalog fixture")
    fixture = fixture_by_id(args.fixture)
    result = run_fixture(
        fixture,
        args.arm,
        order=args.order,
        inter_arrival_ms=args.inter_arrival_ms,
        seed=args.seed,
        keep=args.keep or True,
    )
    print(json.dumps({"manifest": str(result.workspace / "manifest.json"), "observed_sha256": result.manifest["observed_sha256"], "formal_run": False}, indent=2))
    return 0
