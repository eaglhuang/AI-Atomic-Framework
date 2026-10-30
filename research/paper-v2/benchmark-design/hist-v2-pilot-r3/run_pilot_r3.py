#!/usr/bin/env python3
"""Entry point for the HIST-v2 pilot-r3 runner. Does not modify sealed trees."""

from __future__ import annotations

import sys
from pathlib import Path


def _boot() -> None:
    here = Path(__file__).resolve()
    repo = here
    while repo != repo.parent and not (repo / "atm.mjs").is_file():
        repo = repo.parent
    roots = [
        here.parent / "src",
        repo / "research/paper-v2/benchmark-harness/hist-v2-harness-v4/src",
        repo / "research/paper-v2/benchmark-design/hist-v2-classifier-v8/src",
        repo / "research/paper-v2/benchmark-design/hist-v2-smoke-runbook/src",
    ]
    for root in roots:
        text = str(root)
        if text not in sys.path:
            sys.path.insert(0, text)


def main() -> int:
    _boot()
    from hist_v2_pilot_r3.runner import main as run_main

    return run_main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
