"""CLI entry for the HIST-v2 pair classifier."""

from __future__ import annotations

import argparse
import hashlib
import sys

from .emit import write_outputs
from .parameters import DEV_WINDOW, HELDOUT_WINDOW, tool_root
from .pipeline import (
    MalformedCandidate,
    apply_validity,
    classify_candidates,
    load_jsonl,
    parse_candidate,
    validity_index,
)


def load_rules_sha256(root=None) -> str:
    root = tool_root() if root is None else root
    rules_path = root / "RULES.md"
    recorded_path = root / "RULES.sha256"
    digest = hashlib.sha256(rules_path.read_bytes()).hexdigest()
    recorded = recorded_path.read_text(encoding="utf-8").split()[0].strip()
    if recorded != digest:
        raise SystemExit(
            f"RULES.sha256 does not match RULES.md ({recorded} != {digest}). "
            "Refusing to classify with an unfrozen rules file."
        )
    return digest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Classify HIST-v2 candidate PR pairs and pre-label test purpose "
            "plus the correct answer from PR-intrinsic git features only."
        )
    )
    parser.add_argument("--repo", required=True, help="Local git repository (objects must already be present)")
    parser.add_argument("--candidates", required=True, help="JSONL of candidate pairs")
    parser.add_argument("--out-dir", required=True, help="Directory for items.jsonl, excluded.jsonl, expected/, summary.json")
    parser.add_argument("--validity", help="Optional JSONL of gold_test_ids and base_validity attestations")
    parser.add_argument("--dev-window", default=f"{DEV_WINDOW[0]}..{DEV_WINDOW[1]}")
    parser.add_argument("--heldout-window", default=f"{HELDOUT_WINDOW[0]}..{HELDOUT_WINDOW[1]}")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        rules_sha = load_rules_sha256()
        dev_window = _window(args.dev_window)
        heldout_window = _window(args.heldout_window)
        rows = load_jsonl(args.candidates)
        candidates = [parse_candidate(row, index) for index, row in enumerate(rows)]
        if args.validity:
            apply_validity(candidates, validity_index(load_jsonl(args.validity)))
        items, excluded = classify_candidates(
            args.repo,
            candidates,
            rules_sha,
            dev_window,
            heldout_window,
        )
        summary = write_outputs(args.out_dir, items, excluded, rules_sha)
    except MalformedCandidate as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(
        json_counts(summary),
        file=sys.stdout,
    )
    return 0


def json_counts(summary: dict) -> str:
    return (
        f"items={summary['item_count']} excluded={summary['excluded_count']} "
        f"rules_sha256={summary['rules_sha256']}"
    )


def _window(text: str) -> tuple[str, str]:
    if ".." not in text:
        raise MalformedCandidate(f"window must be YYYY-MM-DD..YYYY-MM-DD, got {text}")
    start, end = text.split("..", 1)
    if len(start) != 10 or len(end) != 10 or start > end:
        raise MalformedCandidate(f"invalid window {text}")
    return start, end


if __name__ == "__main__":
    raise SystemExit(main())
