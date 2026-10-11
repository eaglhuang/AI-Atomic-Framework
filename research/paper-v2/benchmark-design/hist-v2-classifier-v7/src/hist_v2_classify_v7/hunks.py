"""Hunk ranges and distances.

`dist` matches HIST v1.x
`research/paper-v2/benchmark-trials/2026-10-09-hist-mining/scripts/frozen-trial/build_pairs.py`.
That generation is sealed and is not imported or modified.
"""

from __future__ import annotations

import re

from .parameters import ADJACENT_MAX_DISTANCE

HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def parse_hunks(diff_text: str) -> list[dict]:
    hunks = []
    for line in diff_text.splitlines():
        match = HUNK_RE.match(line)
        if not match:
            continue
        old_start = int(match.group(1))
        old_len = int(match.group(2)) if match.group(2) is not None else 1
        new_len = int(match.group(4)) if match.group(4) is not None else 1
        start = old_start if old_len == 0 else old_start - 1
        if old_len == 0:
            kind = "insert"
        elif new_len == 0:
            kind = "delete"
        else:
            kind = "replace"
        hunks.append({"start": start, "end": start + old_len, "kind": kind})
    return hunks


def dist(h1: dict, h2: dict) -> int:
    """0 = intersecting or touching; else base lines strictly between the ranges."""
    a0, a1 = h1["start"], h1["end"]
    b0, b1 = h2["start"], h2["end"]
    if a0 < b1 and b0 < a1:
        return 0
    if a0 == b0:
        return 0
    return max(0, max(b0 - a1, a0 - b1))


def min_distance(groups: list[list[dict]]) -> int | None:
    best: int | None = None
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            for left in groups[i]:
                for right in groups[j]:
                    value = dist(left, right)
                    best = value if best is None else min(best, value)
    return best


def stratum_for(min_dist: int | None) -> str:
    if min_dist is None:
        return "O3"
    if min_dist == 0:
        return "O1"
    if min_dist <= ADJACENT_MAX_DISTANCE:
        return "O2"
    return "O3"
