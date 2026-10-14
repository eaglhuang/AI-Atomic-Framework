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
    "multiple-best-common-bases",
    "tool-execution-error",
)
GROUPING_CODES = (
    "shared-pr-component-leak",
    "identical-patch-leak",
    "cherry-pick-leak",
    "backport-leak",
)

DEV_WINDOW = ("2024-01-01", "2025-12-31")
# 2026-01..09 is a later-period historical holdout, not future data.
HELDOUT_WINDOW = ("2026-01-01", "2026-09-30")
LATER_PERIOD_SET = "later-period-historical-holdout"

DESIGN_STATUS = "method-frozen-classification-gated"
PREREG_DIR = "research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/"
CLASSIFIER_DIR = "research/paper-v2/benchmark-design/hist-v2-classifier-v8/"
# The method freeze replaces the old draft path. Do not point the seal back at it.
CANONICAL_DESIGN = PREREG_DIR
INPUTS_COMMIT = "f08599c7d864cd4ede0b50e4c6b6742b4a892f0b"
PREREG_COMMIT = "5dcef16e401f92ba40310f61ac387ba6676fef48"
PREREG_TREE = "8835214bbda73b581757290556c98a086881be2a"
JSONSCHEMA_SPEC = "jsonschema==4.18.0"

INPUT_FILE_SHA256 = {
    "research/paper-v2/benchmark-design/2026-10-11-hist-bench-v2-r7/DECISIONS.md": (
        "e6fd756c5d48f77a242691c6a4fc62ca34ed53ccd37c4162cd994e7190c38ee8"
    ),
    "research/paper-v2/benchmark-design/2026-10-11-hist-bench-v2-r7/HIST_BENCH_V2_PREREG_r7_zh.md": (
        "a4030f9b7606ae724aaf89b8e9d6186759ab146869632d9def3bb2b6df6a3a55"
    ),
    "research/paper-v2/benchmark-design/2026-10-11-hist-bench-v2-r7/README.md": (
        "21bd33c54c017b5355674d7716ec90fb0b5a45b3861d8cf37858e21424221d70"
    ),
    "research/paper-v2/benchmark-design/hist-v2-classifier-v7/RULES.md": (
        "4b139cb5da39383b69dde8ffe3abf325f59aa1e06724bd5f19e39eeb533ac2e0"
    ),
}

PREREG_FILE_SHA256 = {
    "research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/DECISIONS.md": (
        "e6fd756c5d48f77a242691c6a4fc62ca34ed53ccd37c4162cd994e7190c38ee8"
    ),
    "research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/GENERATION.md": (
        "a99284d6fc7144e84cf9e1de04b63021a0ca7e43624c586231633f533524db8d"
    ),
    "research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/HIST_BENCH_V2_PREREG_r7_zh.md": (
        "a4030f9b7606ae724aaf89b8e9d6186759ab146869632d9def3bb2b6df6a3a55"
    ),
    "research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/README.md": (
        "21bd33c54c017b5355674d7716ec90fb0b5a45b3861d8cf37858e21424221d70"
    ),
    "research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/verify.sh": (
        "edf00e6ee6f9cf63dcac966d1243d07be5858d462ea3af3bb6a7dd7ddff979d0"
    ),
    "research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/SHA256SUMS": (
        "353caac64fe66cd19afebb3cf16ab2ba010d5810e4250b9156d76bd77144abec"
    ),
}


def make_seal(
    rules_sha256: str,
    argv: list[str],
    dev_window: tuple[str, str],
    heldout_window: tuple[str, str],
) -> dict:
    """Bind this run to the frozen method, classifier v8, and the actual invocation."""
    return {
        "prereg_v2_0": PREREG_DIR,
        "classifier_v8": CLASSIFIER_DIR,
        "commits": {
            "inputs_main": INPUTS_COMMIT,
            "prereg_v2_0": PREREG_COMMIT,
        },
        "prereg_tree": PREREG_TREE,
        "input_file_sha256": dict(INPUT_FILE_SHA256),
        "prereg_file_sha256": dict(PREREG_FILE_SHA256),
        "rules_sha256": rules_sha256,
        "dependencies": {"jsonschema": "4.18.0"},
        "argv": list(argv),
        "date_windows": {
            "dev": [dev_window[0], dev_window[1]],
            "later_period_historical_holdout": [heldout_window[0], heldout_window[1]],
        },
        "leakage": "global-shared-pr-connected-components",
    }


def tool_root() -> Path:
    return Path(__file__).resolve().parents[2]
