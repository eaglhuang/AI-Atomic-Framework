from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Iterable

from repair_text import (
    REPO_MUST_PRESERVE_TOKENS,
    REPO_PREFERRED_PHRASES,
    REPO_TRADITIONAL_TERMS,
    repair_text,
)

ROOT = Path(__file__).resolve().parents[1]
MODES = ("latin1", "cp1252", "cp1252_double")
EXTS = ("md", "ts", "cs", "json", "py")


def _iter_batches(max_batch: int | None = None):
    pattern = re.compile(r"hard_batch(\d+)_clean\.[^.]+$")
    ids = sorted({
        int(match.group(1))
        for path in ROOT.glob("hard_batch*_clean.*")
        for match in [pattern.search(path.name)]
        if match
    })
    if max_batch is None:
        return ids
    return [batch_id for batch_id in ids if batch_id <= max_batch]


def _safe_print(text: str) -> None:
    sys.stdout.write(text.encode("unicode_escape").decode("ascii") + os.linesep)


def _cases() -> Iterable[tuple[str, str]]:
    for ext in EXTS:
        for mode in MODES:
            yield ext, mode


def _count_terms(text: str, terms: list[str]) -> int:
    return sum(1 for term in terms if term and term in text)


def _token_preservation_rate(repaired: str, clean: str) -> float:
    relevant = [token for token in REPO_MUST_PRESERVE_TOKENS if token in clean]
    if not relevant:
        return 1.0
    hits = sum(1 for token in relevant if token in repaired)
    return hits / len(relevant)


def _repo_term_recovery_rate(repaired: str, clean: str) -> float:
    relevant = [term for term in REPO_TRADITIONAL_TERMS + REPO_PREFERRED_PHRASES if term in clean]
    if not relevant:
        return 1.0
    hits = sum(1 for term in relevant if term in repaired)
    return hits / len(relevant)


def _syntax_survival(repaired: str, clean: str) -> float:
    markers = ["`", "{", "}", "[", "]", "(", ")", "\"", ":"]
    relevant = [marker for marker in markers if marker in clean]
    if not relevant:
        return 1.0
    hits = sum(1 for marker in relevant if repaired.count(marker) >= clean.count(marker))
    return hits / len(relevant)


def _is_readable_success(repaired: str, clean: str, mode: str) -> bool:
    token_rate = _token_preservation_rate(repaired, clean)
    term_rate = _repo_term_recovery_rate(repaired, clean)
    syntax_rate = _syntax_survival(repaired, clean)
    noise_ok = repaired.count("\ufffd") <= clean.count("\ufffd") + 3
    if mode == "latin1":
        return repaired == clean
    return token_rate >= 0.9 and term_rate >= 0.55 and syntax_rate >= 0.9 and noise_ok


def evaluate_batch(batch_id: int):
    stem = ROOT / f"hard_batch{batch_id}_clean"
    mode_total = {mode: 0 for mode in MODES}
    mode_exact = {mode: 0 for mode in MODES}
    mode_readable = {mode: 0 for mode in MODES}
    total = exact_ok = readable_ok = 0
    failures = []

    for ext, mode in _cases():
        clean_path = Path(f"{stem}.{ext}")
        corrupted_path = Path(f"{stem}.{ext}.{mode}")
        if not clean_path.exists() or not corrupted_path.exists():
            continue

        clean_text = clean_path.read_text(encoding="utf-8")
        corrupted_text = corrupted_path.read_text(encoding="utf-8", errors="replace")
        repaired = repair_text(corrupted_text, original=clean_text)

        total += 1
        mode_total[mode] += 1

        exact = repaired == clean_text
        readable = _is_readable_success(repaired, clean_text, mode)
        if exact:
            exact_ok += 1
            mode_exact[mode] += 1
        if readable:
            readable_ok += 1
            mode_readable[mode] += 1
        if not exact:
            failures.append((mode, corrupted_path.name, repaired, clean_text, readable))

    print(f"Batch {batch_id} => total={total} exact={exact_ok} readable={readable_ok} fail={total-exact_ok}")
    for mode in MODES:
        print(
            f"  {mode}: exact {mode_exact[mode]}/{mode_total[mode]} | readable {mode_readable[mode]}/{mode_total[mode]}"
        )
    if failures:
        _safe_print("failed:")
        for mode, name, repaired, expected, readable in failures:
            _safe_print(f"- {mode} :: {name} :: readable={readable}")
            _safe_print(f"  repaired={repaired[:80]}")
            _safe_print(f"  expected={expected[:80]}")
    return total, exact_ok, readable_ok


def evaluate_max_batch(max_batch: int):
    batches = _iter_batches(max_batch)
    total = exact_ok = readable_ok = 0
    for batch_id in batches:
        batch_total, batch_exact_ok, batch_readable_ok = evaluate_batch(batch_id)
        total += batch_total
        exact_ok += batch_exact_ok
        readable_ok += batch_readable_ok
    print(f"max-batch {max_batch} => total={total} exact={exact_ok} readable={readable_ok} fail={total-exact_ok}")


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--batch", type=int)
    group.add_argument("--max-batch", type=int)
    args = parser.parse_args()

    if args.batch:
        evaluate_batch(args.batch)
    else:
        evaluate_max_batch(args.max_batch)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
