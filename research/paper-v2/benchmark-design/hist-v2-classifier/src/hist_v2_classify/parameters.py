"""Frozen numeric parameters for the HIST-v2 pair classifier.

The prose contract is RULES.md. CLI startup checks RULES.sha256 against that file.
"""

from __future__ import annotations

from pathlib import Path

# O2 is distance 1..3. Class A requires a strictly greater hunk distance.
ADJACENT_MAX_DISTANCE = 3

PATCH_SOURCES = ("final-head", "rebase-before-head", "3way")
WRITE_CLASSES = ("A", "B", "C", "A'", "B'", "D")
SEMANTIC_FLAGS = ("S", "N")
EXCLUSION_REASONS = (
    "head-unavailable",
    "checkout-failed",
    "binary-or-non-utf8",
    "unapplicable-to-common-base",
)
GROUPING_CODES = ("shared-pr-with-dev",)

DEV_WINDOW = ("2024-01-01", "2025-12-31")
HELDOUT_WINDOW = ("2026-01-01", "2026-09-30")

CANONICAL_DESIGN = (
    "research/paper-v2/benchmark-design/2026-10-10-hist-bench-v2/"
    "HIST_BENCH_V2_PREREG_zh.md"
)


def tool_root() -> Path:
    return Path(__file__).resolve().parents[2]
