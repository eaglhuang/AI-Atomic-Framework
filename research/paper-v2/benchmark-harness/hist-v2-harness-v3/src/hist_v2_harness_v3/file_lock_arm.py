"""file_lock: read and rewrite the hunk inside the whole-file lock. No git merge-file."""

from pathlib import Path

from .atomic import atomic_replace
from .clock import Clock
from .deadline import AttemptBudget
from .limits import DEADLINE_SECONDS
from .locking import empty_metrics, whole_file_lock
from .patchutil import PatchApplyError, apply_unified_patch
from .result import WriterResult
from .workspace import append_event, read_text


def run_file_lock(workspace: Path, filename: str, proposal: dict, patch: str, clock: Clock, order_index: int) -> WriterResult:
    budget = AttemptBudget()
    budget.open_first(clock.now())
    item_stop = budget.first_submit + DEADLINE_SECONDS
    metrics = empty_metrics()
    target = workspace / filename
    events = [{"type": "proposal", "proposal_id": proposal["id"], "arm": "file_lock", "order_index": order_index}]
    append_event(workspace, events[-1])
    if budget.expired(clock.now(), item_stop):
        return _finish(proposal, budget, item_stop, "timeout", "own-deadline", False, None, None, metrics, events, None)
    with whole_file_lock(workspace / "file.lock", metrics):
        current = read_text(target)
        events.append({"type": "attempt", "proposal_id": proposal["id"], "attempt": 0, "inside_lock": True})
        append_event(workspace, events[-1])
        try:
            updated = apply_unified_patch(current, patch)
        except PatchApplyError as error:
            return _finish(
                proposal, budget, item_stop, "rejected-conflict", "conflict", False, None, None, metrics, events, str(error)
            )
        renamed = atomic_replace(target, updated.encode("utf-8"), clock, budget.effective_stop(item_stop))
        if renamed is None:
            return _finish(proposal, budget, item_stop, "timeout", "own-deadline", False, None, None, metrics, events, None)
        ack = clock.now()
        events.append({"type": "commit", "proposal_id": proposal["id"], "rename_at": renamed, "ack_at": ack})
        append_event(workspace, events[-1])
        _maybe_rename_path(workspace, filename, proposal)
        return _finish(proposal, budget, item_stop, "committed", "acked-in-window", True, renamed, ack, metrics, events, None)


def _maybe_rename_path(workspace: Path, filename: str, proposal: dict) -> None:
    if proposal.get("operation") != "rename":
        return
    source = workspace / filename
    target = workspace / proposal["rename_to"]
    source.replace(target)


def _finish(proposal, budget, item_stop, terminal, reason, accepted, renamed, ack, metrics, events, detail) -> WriterResult:
    accepted_ids = [proposal["id"]] if accepted else []
    return WriterResult(
        proposal_id=proposal["id"],
        arm="file_lock",
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
        batch_id=None,
        accepted_ids=accepted_ids,
        metrics=metrics,
        events=events,
        detail=detail,
    )
