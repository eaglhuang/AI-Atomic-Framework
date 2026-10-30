"""steward: one coordinator binds an immutable base, then one atomic rename.

Writers are separate processes. The process that acquires the whole-file lock
composes every proposal that reached the barrier. The others only observe.
"""

import time
from pathlib import Path

from .atomic import atomic_replace
from .barrier import wait_barrier
from .clock import MonotonicClock
from .deadline import AttemptBudget, timeout_reason
from .itemclock import clocks_record, open_item_stop
from .legal import Member, select_arrival_maximal, set_key
from .materialize import failure_terminal, scheduled_delay_seconds
from .patchutil import PatchApplyError, apply_unified_patch
from .locking import empty_metrics, whole_file_lock
from .result import WriterResult
from .workspace import append_event, read_json, read_text, write_json


def run_steward_process(job: dict, clock=None, stamps: list | None = None) -> WriterResult:
    """v4: the first submit is the inbox write after the barrier and the
    scheduled delay (v3 opened the budget before the barrier)."""
    workspace = Path(job["workspace"])
    proposal = job["proposal"]
    clock = clock or MonotonicClock(job.get("test_wall_jump_s", 0.0))
    stamps = [] if stamps is None else stamps
    budget = AttemptBudget()
    metrics = empty_metrics()
    if not stamps:
        wait_barrier(workspace / "barrier", str(proposal["id"]), job["peers"])
        stamps.append(clock.stamp("barrier_exit"))
        time.sleep(scheduled_delay_seconds(job))
    failure = None
    try:
        mine = apply_unified_patch(job["base"], job["patch"])
    except PatchApplyError as exc:
        mine = None
        failure = failure_terminal(str(exc))
    budget.open_first(clock.now())
    stamps.append({**clock.stamp("submit"), "mono": budget.first_submit})
    item_stop = open_item_stop(workspace, proposal["id"], budget.first_submit)
    write_json(
        workspace / "inbox" / f"{proposal['id']}.json",
        {
            "proposal_id": proposal["id"],
            "patch": job["patch"],
            "base": job["base"],
            "arrived_at": budget.first_submit,
            "first_submit": budget.first_submit,
            "mine_ok": mine is not None,
            "failure": failure,
            "operation": proposal.get("operation"),
            "rename_to": proposal.get("rename_to"),
        },
    )
    append_event(workspace, {"type": "proposal", "proposal_id": proposal["id"], "arm": "steward"})
    with whole_file_lock(workspace / "file.lock", metrics):
        receipt_path = workspace / "results" / f"{proposal['id']}.json"
        if receipt_path.exists():
            stored = read_json(receipt_path)
            stored["metrics"] = metrics
            stored["first_submit"] = budget.first_submit
            stored["executable_seconds"] = budget.executable_seconds(item_stop)
            stored["retries"] = budget.retries
            stored["attempts"] = budget.attempts
            stored["clocks"] = clocks_record(stamps, budget, item_stop)
            return WriterResult(**stored)
        if not _wait_members(workspace, job["peers"]):
            return _single(proposal, budget, item_stop, "timeout", "item-stop", False, None, None, metrics, "members-missing", stamps)
        if (workspace / "batch.json").exists():
            return _from_batch(workspace, proposal, budget, item_stop, metrics, stamps)
        return _compose(workspace, job, budget, item_stop, metrics, clock, stamps)


def _wait_members(workspace: Path, peers: int) -> bool:
    started = time.monotonic()
    while time.monotonic() - started < 5:
        if len(list((workspace / "inbox").glob("*.json"))) >= peers:
            return True
        time.sleep(0.01)
    return False


def _compose(workspace, job, budget, item_stop, metrics, clock, stamps) -> WriterResult:
    base_text = read_text(workspace / job["filename"])
    members = []
    errors = []
    conflicts = []
    for path in sorted((workspace / "inbox").glob("*.json")):
        row = read_json(path)
        if not row["mine_ok"]:
            if row.get("failure") == "error":
                errors.append(row["proposal_id"])
            else:
                conflicts.append(row["proposal_id"])
            continue
        try:
            mine = apply_unified_patch(row["base"], row["patch"])
        except PatchApplyError as exc:
            if failure_terminal(str(exc)) == "error":
                errors.append(row["proposal_id"])
            else:
                conflicts.append(row["proposal_id"])
            continue
        if mine is None:
            conflicts.append(row["proposal_id"])
            continue
        members.append(Member(row["proposal_id"], mine, row["arrived_at"]))
    accepted, content = select_arrival_maximal(base_text, members)
    accepted_ids = set_key([member.proposal_id for member in accepted])
    batch_id = f"steward-{job['proposal']['id']}"
    renamed = None
    ack = None
    if accepted_ids and content is not None:
        renamed = atomic_replace(workspace / job["filename"], content.encode("utf-8"), clock, lambda: budget.effective_stop(item_stop))
        if renamed is None:
            reason = timeout_reason(budget.first_submit, item_stop)
            _write_all(workspace, job, budget, item_stop, metrics, accepted_ids, batch_id, "timeout", reason, None, None)
            return _single(job["proposal"], budget, item_stop, "timeout", reason, False, None, None, metrics, None, stamps)
        stamps.append({**clock.stamp("rename"), "mono": renamed})
        ack = clock.now()
        stamps.append({**clock.stamp("ack"), "mono": ack})
        proposal = job["proposal"]
        if proposal.get("operation") == "rename" and proposal["id"] in accepted_ids:
            (workspace / job["filename"]).replace(workspace / proposal["rename_to"])
    terminal_for_batch = "committed" if accepted_ids else "rejected-conflict"
    _write_all(
        workspace,
        job,
        budget,
        item_stop,
        metrics,
        accepted_ids,
        batch_id,
        terminal_for_batch,
        "acked-in-window" if accepted_ids else "conflict",
        renamed,
        ack,
        errors,
        conflicts,
    )
    append_event(
        workspace,
        {"type": "batch", "batch_id": batch_id, "batch_size": len(members) + len(errors) + len(conflicts), "accepted_ids": accepted_ids},
    )
    return _from_batch(workspace, job["proposal"], budget, item_stop, metrics, stamps)


def _write_all(workspace, job, budget, item_stop, metrics, accepted_ids, batch_id, terminal, reason, renamed, ack, errors=None, conflicts=None) -> None:
    errors = errors or []
    conflicts = conflicts or []
    batch = {
        "batch_id": batch_id,
        "batch_size": len(list((workspace / "inbox").glob("*.json"))),
        "accepted_ids": accepted_ids,
        "rename_at": renamed,
        "ack_at": ack,
        "errors": errors,
        "conflicts": conflicts,
    }
    write_json(workspace / "batch.json", batch)
    for path in (workspace / "inbox").glob("*.json"):
        row = read_json(path)
        proposal_id = row["proposal_id"]
        accepted = proposal_id in accepted_ids
        if terminal == "timeout":
            arm_terminal, stop_reason, accepted_flag = "timeout", timeout_reason(row.get("first_submit", budget.first_submit), item_stop), False
            accepted = False
        elif proposal_id in errors:
            arm_terminal, stop_reason, accepted_flag = "error", "error", False
        elif proposal_id in conflicts:
            arm_terminal, stop_reason, accepted_flag = "rejected-conflict", "conflict", False
        elif accepted:
            arm_terminal, stop_reason, accepted_flag = "committed", "acked-in-window", True
        else:
            arm_terminal, stop_reason, accepted_flag = "rejected-conflict", "excluded-by-arrival-maximal-subset", False
        payload = _payload(
            proposal_id,
            arm_terminal,
            stop_reason,
            accepted_flag,
            budget,
            item_stop,
            renamed if accepted else None,
            ack if accepted else None,
            metrics if proposal_id == job["proposal"]["id"] else empty_metrics(),
            batch_id,
            batch["batch_size"],
            accepted_ids,
        )
        write_json(workspace / "results" / f"{proposal_id}.json", payload)


def _from_batch(workspace, proposal, budget, item_stop, metrics, stamps) -> WriterResult:
    path = workspace / "results" / f"{proposal['id']}.json"
    started = time.monotonic()
    while not path.exists() and time.monotonic() - started < 5:
        time.sleep(0.01)
    stored = read_json(path)
    if stored["proposal_id"] == proposal["id"]:
        stored["metrics"] = metrics
        stored["executable_seconds"] = budget.executable_seconds(item_stop)
        stored["first_submit"] = budget.first_submit
        stored["clocks"] = clocks_record(stamps, budget, item_stop)
    return WriterResult(**stored)


def _payload(proposal_id, terminal, reason, accepted, budget, item_stop, renamed, ack, metrics, batch_id, batch_size, accepted_ids) -> dict:
    return {
        "proposal_id": proposal_id,
        "arm": "steward",
        "arm_terminal": terminal,
        "stop_reason": reason,
        "accepted": accepted,
        "retries": budget.retries,
        "attempts": budget.attempts,
        "first_submit": budget.first_submit,
        "executable_seconds": budget.executable_seconds(item_stop),
        "rename_at": renamed,
        "ack_at": ack,
        "batch_size": batch_size,
        "batch_id": batch_id,
        "accepted_ids": accepted_ids,
        "metrics": metrics,
        "events": [{"type": "batch", "batch_id": batch_id, "batch_size": batch_size}],
        "detail": None,
    }


def _stored(payload: dict, metrics: dict) -> dict:
    payload["metrics"] = metrics
    return payload


def _single(proposal, budget, item_stop, terminal, reason, accepted, renamed, ack, metrics, detail, stamps) -> WriterResult:
    return WriterResult(
        proposal_id=proposal["id"],
        arm="steward",
        arm_terminal=terminal,
        stop_reason=reason,
        accepted=accepted,
        retries=budget.retries,
        attempts=budget.attempts,
        first_submit=budget.first_submit,
        executable_seconds=budget.executable_seconds(item_stop),
        rename_at=renamed,
        ack_at=ack,
        metrics=metrics,
        detail=detail,
        clocks=clocks_record(stamps, budget, item_stop),
    )
