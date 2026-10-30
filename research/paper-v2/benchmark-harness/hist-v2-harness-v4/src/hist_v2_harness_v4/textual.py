"""textual_merge_file. The outside candidate is discarded when the base moved.

The decision comes from classifier v8 `textual_merge_file_on_lock` (R4-D2).
A stale candidate is never the bytes that get renamed into place.
"""

from pathlib import Path

from hist_v2_classify_v8.score import textual_merge_file_on_lock

from .atomic import atomic_replace
from .clock import Clock
from .deadline import AttemptBudget, timeout_reason
from .digest import sha256_text
from .itemclock import clocks_record, open_item_stop
from .locking import empty_metrics, whole_file_lock
from .materialize import failure_terminal
from .merge import git_merge_file
from .patchutil import PatchApplyError, apply_unified_patch
from .result import WriterResult
from .workspace import append_event, read_text


def run_textual(
    workspace: Path,
    filename: str,
    base: str,
    proposal: dict,
    patch: str,
    clock: Clock,
    order_index: int,
    before_lock=None,
    retries_already: int = 0,
    stamps: list | None = None,
    item_clock=None,
) -> WriterResult:
    stamps = [] if stamps is None else stamps
    budget = AttemptBudget()
    budget.open_first(clock.now())
    stamps.append({**clock.stamp("submit"), "mono": budget.first_submit})
    budget.note_retries(retries_already)
    item_stop = open_item_stop(workspace, proposal["id"], budget.first_submit, item_clock)
    metrics = empty_metrics()
    target = workspace / filename
    events = [{"type": "proposal", "proposal_id": proposal["id"], "arm": "textual_merge_file", "order_index": order_index}]
    append_event(workspace, events[-1])
    if budget.expired(clock.now(), item_stop):
        return _finish(proposal, budget, item_stop, "timeout", timeout_reason(budget.first_submit, item_stop), False, None, None, metrics, events, None, None, stamps)
    outside = read_text(target)
    try:
        mine = apply_unified_patch(base, patch)
    except PatchApplyError as error:
        detail = str(error)
        if failure_terminal(detail) == "error":
            return _finish(proposal, budget, item_stop, "error", "error", False, None, None, metrics, events, detail, None, stamps)
        return _finish(proposal, budget, item_stop, "rejected-conflict", "conflict", False, None, None, metrics, events, detail, None, stamps)
    code, outside_candidate = git_merge_file(outside, base, mine)
    outside_bytes = outside_candidate if code == 0 else None
    if before_lock is not None:
        before_lock(target)
    with whole_file_lock(workspace / "file.lock", metrics):
        inside = read_text(target)
        decision = textual_merge_file_on_lock(
            outside_base=outside,
            inside_base=inside,
            retries_already_used=budget.retries,
        )
        events.append({"type": "attempt", "proposal_id": proposal["id"], "decision": decision["stop_reason"], "attempt": budget.attempts - 1})
        append_event(workspace, events[-1])
        if decision["clock_resets"]:
            raise RuntimeError("the frozen rule says the clock does not reset")
        commit_bytes = None
        if decision["may_commit_outside_candidate"]:
            if code != 0 or outside_bytes is None:
                return _finish(proposal, budget, item_stop, "rejected-conflict", "conflict", False, None, None, metrics, events, "merge-conflict", None, stamps)
            commit_bytes = outside_bytes
        elif decision["recompute"]:
            if not budget.consume_retry(clock.now(), item_stop):
                return _refuse_stale(proposal, budget, item_stop, metrics, events, outside_bytes, stamps, "retry-limit")
            events.append(
                {
                    "type": "discard-stale",
                    "proposal_id": proposal["id"],
                    "stale_sha256": sha256_text(outside_bytes or ""),
                    "retries": budget.retries,
                }
            )
            append_event(workspace, events[-1])
            recomputed_code, recomputed = git_merge_file(inside, base, mine)
            if recomputed_code != 0:
                return _refuse_stale(proposal, budget, item_stop, metrics, events, outside_bytes, stamps, "conflict")
            commit_bytes = recomputed
            if outside_bytes is not None and commit_bytes == outside_bytes and inside != outside:
                # Equal bytes can be a legal recompute. The stale object itself is not submitted.
                events.append({"type": "recompute-matched-stale-bytes", "proposal_id": proposal["id"]})
        else:
            return _refuse_stale(proposal, budget, item_stop, metrics, events, outside_bytes, stamps, decision["stop_reason"] or "retry-limit")
        if decision["discard_outside_candidate"] and commit_bytes is outside_bytes and inside != outside:
            return _refuse_stale(proposal, budget, item_stop, metrics, events, outside_bytes, stamps, "stale-candidate")
        renamed = atomic_replace(target, commit_bytes.encode("utf-8"), clock, lambda: budget.effective_stop(item_stop))
        if renamed is None:
            return _finish(proposal, budget, item_stop, "timeout", timeout_reason(budget.first_submit, item_stop), False, None, None, metrics, events, None, outside_bytes, stamps)
        stamps.append({**clock.stamp("rename"), "mono": renamed})
        ack = clock.now()
        stamps.append({**clock.stamp("ack"), "mono": ack})
        events.append({"type": "commit", "proposal_id": proposal["id"], "rename_at": renamed})
        append_event(workspace, events[-1])
        if proposal.get("operation") == "rename":
            (workspace / filename).replace(workspace / proposal["rename_to"])
        return _finish(proposal, budget, item_stop, "committed", "acked-in-window", True, renamed, ack, metrics, events, None, outside_bytes, stamps)


def _refuse_stale(proposal, budget, item_stop, metrics, events, outside_bytes, stamps, reason) -> WriterResult:
    events.append({"type": "stale-not-committed", "proposal_id": proposal["id"], "stop_reason": reason})
    return _finish(proposal, budget, item_stop, "retry-exhausted" if "retry" in reason else "rejected-conflict", reason, False, None, None, metrics, events, reason, outside_bytes, stamps)


def _finish(proposal, budget, item_stop, terminal, reason, accepted, renamed, ack, metrics, events, detail, outside_bytes, stamps) -> WriterResult:
    result = WriterResult(
        proposal_id=proposal["id"],
        arm="textual_merge_file",
        arm_terminal=terminal,
        stop_reason=reason,
        accepted=accepted,
        retries=budget.retries,
        attempts=budget.attempts,
        first_submit=budget.first_submit,
        executable_seconds=budget.executable_seconds(item_stop),
        rename_at=renamed,
        ack_at=ack,
        batch_size=1 if accepted else 0,
        accepted_ids=[proposal["id"]] if accepted else [],
        metrics=metrics,
        events=events,
        detail=detail,
        clocks=clocks_record(stamps, budget, item_stop),
    )
    result.events.append({"outside_candidate_sha256": sha256_text(outside_bytes or "")})
    return result
