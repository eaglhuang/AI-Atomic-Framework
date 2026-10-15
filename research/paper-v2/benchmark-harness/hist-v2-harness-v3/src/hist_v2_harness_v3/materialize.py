"""Arrival jitter and proposal materialization for harness v3.

§9 jitter is uniform on [0, min(10 ms, 10% of the interval)), determined by
the seed together with the fixture, order, interval, and writer index.
Interval 0 has cap 0.

A historical unified diff is the PR's own merge-base to its head. Applying
that diff onto the common base is not the classifier's 3-way mine. When a
proposal carries parent_text and head_text, non-file_lock arms receive a diff
of the common base against git merge-file(base, parent, head). file_lock keeps
the historical hunk. A context mismatch is a conflict, not a tool error.
"""

import random
import subprocess
import tempfile
from pathlib import Path

from . import catalog
from .limits import JITTER_INTERVAL_FRACTION, JITTER_MAX_MS
from .merge import git_merge_file


def jitter_cap_ms(inter_arrival_ms: int) -> float:
    return min(float(JITTER_MAX_MS), float(inter_arrival_ms) * JITTER_INTERVAL_FRACTION)


def jitter_ms(seed: int, fixture_id: str, order: str, inter_arrival_ms: int, order_index: int) -> float:
    cap = jitter_cap_ms(inter_arrival_ms)
    if cap == 0:
        return 0.0
    token = f"hist-v2-jitter:{seed}:{fixture_id}:{order}:{inter_arrival_ms}:{order_index}"
    return random.Random(token).uniform(0.0, cap)


def arrival_delay_ms(seed: int, fixture_id: str, order: str, inter_arrival_ms: int, order_index: int) -> float:
    return (order_index * float(inter_arrival_ms)) + jitter_ms(seed, fixture_id, order, inter_arrival_ms, order_index)


def scheduled_delay_seconds(job: dict) -> float:
    if "arrival_delay_ms" in job:
        return float(job["arrival_delay_ms"]) / 1000.0
    return float(job["order_index"]) * float(job["inter_arrival_ms"]) / 1000.0


def failure_terminal(detail: str) -> str:
    """Context mismatch is a conflict. A dead applier is a tool error."""
    text = detail.lower()
    if "produced no output" in text or "git merge-file failed" in text:
        return "error"
    return "conflict"


def historical_patch(fixture: dict, proposal: dict) -> str:
    diff = proposal.get("unified_diff")
    if isinstance(diff, str):
        return diff
    return catalog.build_patch(fixture, proposal)


def unified_diff(filename: str, before: str, after: str) -> str:
    if before == after:
        return ""
    with tempfile.TemporaryDirectory(prefix="hist-v2-diff-") as temp:
        root = Path(temp)
        left = root / "before"
        right = root / "after"
        left.write_text(before, encoding="utf-8")
        right.write_text(after, encoding="utf-8")
        result = subprocess.run(
            ["git", "diff", "--no-index", "--", str(left), str(right)],
            capture_output=True,
            check=False,
        )
    if result.returncode not in (0, 1):
        detail = result.stderr.decode("utf-8", "replace")[:400]
        raise RuntimeError(f"git diff failed: {detail}")
    text = result.stdout.decode("utf-8")
    text = text.replace(str(left), f"a/{filename}").replace(str(right), f"b/{filename}")
    return text


def transplanted_patch(filename: str, base: str, parent: str, head: str) -> str | None:
    """None means the 3-way merge conflicted. A string is a diff against base."""
    code, merged = git_merge_file(base, parent, head)
    if code != 0:
        return None
    return unified_diff(filename, base, merged)


def patch_for_arm(fixture: dict, proposal: dict, arm: str) -> str:
    historical = historical_patch(fixture, proposal)
    if arm == "file_lock":
        return historical
    parent = proposal.get("parent_text")
    head = proposal.get("head_text")
    if isinstance(parent, str) and isinstance(head, str):
        transplanted = transplanted_patch(fixture["filename"], fixture["base"], parent, head)
        if transplanted is not None:
            return transplanted
    return historical
