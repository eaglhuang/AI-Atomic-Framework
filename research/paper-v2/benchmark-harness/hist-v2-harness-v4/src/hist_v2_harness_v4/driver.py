"""Multi-session driver. One process per writer. Does not run the plan matrix."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from .catalog import ordered_proposals
from .clock import MonotonicClock
from .validity import cell_validity
from .materialize import arrival_delay_ms, failure_terminal, patch_for_arm
from .digest import hash_compose_bytes, sha256_text
from .file_lock_arm import run_file_lock
from .limits import ATM_COMPOSE_WINDOW_MS, ATM_MAX_BATCH_SIZE, DEADLINE_SECONDS
from .manifest import build_manifest
from .paths import node_dir, python_env, repo_root
from .result import WriterResult
from .textual import run_textual
from .workspace import prepare_workspace, read_text


class FixtureRun:
    def __init__(self, fixture: dict, arm: str, body: str, results: list[WriterResult], manifest: dict, workspace: Path, validity: dict | None = None) -> None:
        self.validity = validity
        self.fixture = fixture
        self.arm = arm
        self.body = body
        self.results = results
        self.manifest = manifest
        self.workspace = workspace

    @property
    def accepted_ids(self) -> list[int]:
        return sorted(result.proposal_id for result in self.results if result.accepted)


def run_fixture(
    fixture: dict,
    arm: str,
    *,
    order: str = "forward",
    inter_arrival_ms: int = 0,
    seed: int = 0,
    workspace: Path | None = None,
    keep: bool = False,
    test_wall_jump_s: dict | None = None,
) -> FixtureRun:
    """``test_wall_jump_s`` maps order_index -> seconds and exists for the A9
    clock-jump test only. Runs leave it None."""
    if arm not in ("atm", "textual_merge_file", "steward", "file_lock"):
        raise ValueError(arm)
    root = workspace or Path(tempfile.mkdtemp(prefix="hist-v2-harness-"))
    prepare_workspace(root, fixture)
    proposals = ordered_proposals(fixture, order)
    clock = MonotonicClock()
    driver_stamps = [clock.stamp("cell_start")]
    if arm == "atm":
        results = _run_atm(root, fixture, proposals, inter_arrival_ms, seed, order)
    else:
        results = _run_python_workers(root, fixture, proposals, arm, inter_arrival_ms, seed, order, test_wall_jump_s or {})
    driver_stamps.append(clock.stamp("cell_end"))
    designed = [arrival_delay_ms(seed, fixture["id"], order, inter_arrival_ms, index) for index in range(len(proposals))]
    validity = None
    if arm != "atm":
        validity = cell_validity([result.as_dict() for result in results], designed, driver_stamps)
    _apply_rename(root, fixture, results)
    body = _observe_body(root, fixture)
    manifest = build_manifest(
        fixture=fixture,
        arm=arm,
        seed=seed,
        order=order,
        inter_arrival_ms=inter_arrival_ms,
        body=body,
        results=results,
        workspace=root,
    )
    manifest["validity"] = validity
    manifest["driver_clock_stamps"] = driver_stamps
    manifest["harness"] = "hist-v2-harness-v4"
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if not keep:
        manifest["workspace"] = str(root)
    return FixtureRun(fixture, arm, body, results, manifest, root, validity)


def _run_python_workers(root, fixture, proposals, arm, inter_arrival_ms, seed: int, order: str, wall_jumps: dict) -> list[WriterResult]:
    processes = []
    for index, proposal in enumerate(proposals):
        job = {
            "arm": arm,
            "workspace": str(root),
            "filename": fixture["filename"],
            "base": fixture["base"],
            "proposal": proposal,
            "patch": patch_for_arm(fixture, proposal, arm),
            "peers": len(proposals),
            "order_index": index,
            "inter_arrival_ms": inter_arrival_ms,
            "arrival_delay_ms": arrival_delay_ms(seed, fixture["id"], order, inter_arrival_ms, index),
        }
        if index in wall_jumps:
            job["test_wall_jump_s"] = float(wall_jumps[index])
        job_path = root / f"job-{proposal['id']}.json"
        job_path.write_text(json.dumps(job), encoding="utf-8")
        processes.append(
            subprocess.Popen(
                [sys.executable, "-m", "hist_v2_harness_v4.worker", str(job_path)],
                cwd=repo_root(),
                env=python_env(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        )
    results = []
    for process, proposal in zip(processes, proposals):
        try:
            stdout, stderr = process.communicate(timeout=40)
        except subprocess.TimeoutExpired as error:
            for other in processes:
                other.kill()
            raise RuntimeError(f"writer {proposal['id']} did not finish within 40 s") from error
        if process.returncode != 0:
            raise RuntimeError(f"writer {proposal['id']} exit {process.returncode}\n{stderr}\n{stdout}")
        payload = json.loads((root / "results" / f"{proposal['id']}.json").read_text(encoding="utf-8"))
        results.append(WriterResult(**payload))
    return results


def _run_atm(root: Path, fixture: dict, proposals: list[dict], inter_arrival_ms: int, seed: int, order: str) -> list[WriterResult]:
    inbox = root / "compose-inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    target = root / fixture["filename"]
    processes = []
    for index, proposal in enumerate(proposals):
        patch = patch_for_arm(fixture, proposal, "atm")
        job = {
            "workspace": str(root),
            "inboxDir": str(inbox),
            "targetPath": str(target),
            "targetFile": fixture["filename"],
            "proposalId": str(proposal["id"]),
            "actorId": f"writer-{proposal['id']}",
            "taskId": f"FIXTURE-{fixture['id']}-{proposal['id']}",
            "baseHash": hash_compose_bytes(fixture["base"]),
            "baseBytes": fixture["base"],
            "patch": patch,
            "peers": len(proposals),
            "orderIndex": index,
            "interArrivalMs": inter_arrival_ms,
            "arrivalDelayMs": arrival_delay_ms(seed, fixture["id"], order, inter_arrival_ms, index),
            "composeWindowMs": ATM_COMPOSE_WINDOW_MS,
            "maxBatchSize": ATM_MAX_BATCH_SIZE,
            "deadlineMs": DEADLINE_SECONDS * 1000,
            "operation": proposal.get("operation", "edit"),
            "renameTo": proposal.get("rename_to"),
        }
        job_path = root / f"atm-job-{proposal['id']}.json"
        job_path.write_text(json.dumps(job), encoding="utf-8")
        major = int((subprocess.check_output(["node", "-p", "process.versions.node"], text=True).split("."))[0])
        flag = "--strip-types" if major >= 24 else "--experimental-strip-types"
        processes.append(
            (
                proposal,
                job_path,
                subprocess.Popen(
                    ["node", flag, str(node_dir() / "atm-writer.ts"), str(job_path)],
                    cwd=repo_root(),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                ),
            )
        )
    raw = []
    for proposal, job_path, process in processes:
        stdout, stderr = process.communicate(timeout=40)
        result_path = Path(f"{job_path}.result.json")
        if not result_path.exists():
            raise RuntimeError(f"atm writer {proposal['id']} exit {process.returncode}\n{stderr}\n{stdout}")
        parsed = json.loads(result_path.read_text(encoding="utf-8"))
        if not parsed.get("ok"):
            raise RuntimeError(parsed.get("detail") or f"atm writer {proposal['id']} failed")
        raw.append(parsed["receipt"])
    reconciled = _reconcile_atm(inbox, [str(proposal["id"]) for proposal in proposals], root)
    by_id = {receipt["proposalId"]: receipt for receipt in reconciled}
    results = []
    for proposal in proposals:
        receipt = by_id[str(proposal["id"])]
        results.append(_receipt_to_result(proposal["id"], receipt))
    return results


def _reconcile_atm(inbox: Path, proposal_ids: list[str], root: Path) -> list[dict]:
    out_path = root / "atm-reconcile.json"
    job_path = root / "atm-reconcile-job.json"
    job_path.write_text(json.dumps({"inboxDir": str(inbox), "proposalIds": proposal_ids, "outPath": str(out_path)}), encoding="utf-8")
    major = int(subprocess.check_output(["node", "-p", "process.versions.node"], text=True).split(".")[0])
    flag = "--strip-types" if major >= 24 else "--experimental-strip-types"
    done = subprocess.run(
        ["node", flag, str(node_dir() / "reconcile.ts"), str(job_path)],
        cwd=repo_root(),
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode != 0 or not out_path.exists():
        raise RuntimeError(done.stderr or "atm reconcile failed")
    parsed = json.loads(out_path.read_text(encoding="utf-8"))
    if not parsed.get("ok"):
        raise RuntimeError(parsed.get("detail") or "atm reconcile failed")
    return parsed["receipts"]


def _receipt_to_result(proposal_id: int, receipt: dict) -> WriterResult:
    accepted_ids = [int(value) for value in receipt.get("acceptedSetKey") or []]
    terminal = receipt.get("terminal")
    detail = receipt.get("detail") or ""
    stop_reason = receipt.get("stopReason") or ""
    if terminal == "error" and failure_terminal(str(detail)) == "conflict":
        terminal = "rejected-conflict"
        stop_reason = "conflict"
    accepted = terminal == "committed"
    first = float(receipt.get("firstSubmittedAt") or 0) / 1000.0
    rename_at = None if receipt.get("renameAt") is None else float(receipt["renameAt"]) / 1000.0
    ack_at = None if receipt.get("ackAt") is None else float(receipt["ackAt"]) / 1000.0
    # The coordinator clock is milliseconds. executableSeconds is already seconds.
    return WriterResult(
        proposal_id=proposal_id,
        arm="atm",
        arm_terminal=terminal,
        stop_reason=stop_reason,
        accepted=accepted,
        retries=int(receipt.get("retryCount") or 0),
        attempts=int(receipt.get("attemptCount") or 0),
        first_submit=first,
        executable_seconds=float(receipt.get("executableSeconds") or 0),
        rename_at=rename_at,
        ack_at=ack_at,
        batch_size=receipt.get("batchSize"),
        batch_id=receipt.get("batchId"),
        accepted_ids=accepted_ids,
        metrics={},
        events=[
            {
                "type": "batch",
                "proposal_id": proposal_id,
                "batch_id": receipt.get("batchId"),
                "batch_size": receipt.get("batchSize"),
                "member_proposal_ids": receipt.get("memberProposalIds"),
                "accepted_ids": accepted_ids,
            },
            {
                "type": "commit" if accepted else "attempt",
                "proposal_id": proposal_id,
                "rename_count": receipt.get("renameCount"),
                "terminal": terminal,
            },
        ],
        detail=receipt.get("detail"),
    )


def _apply_rename(root: Path, fixture: dict, results: list[WriterResult]) -> None:
    proposals = fixture["proposals"]
    if len(proposals) != 1 or proposals[0].get("operation") != "rename":
        return
    if not any(result.accepted for result in results):
        return
    source = root / fixture["filename"]
    dest = root / proposals[0]["rename_to"]
    if source.exists() and not dest.exists():
        source.replace(dest)


def _observe_body(root: Path, fixture: dict) -> str:
    proposals = fixture["proposals"]
    if len(proposals) == 1 and proposals[0].get("operation") == "rename":
        renamed = root / proposals[0]["rename_to"]
        original = root / fixture["filename"]
        if original.exists():
            raise RuntimeError("rename left the source path in place")
        return read_text(renamed)
    return read_text(root / fixture["filename"])


def _remove(root: Path) -> None:
    if not root.exists():
        return
    for child in sorted(root.rglob("*"), reverse=True):
        if child.is_file() or child.is_symlink():
            child.unlink()
        else:
            child.rmdir()
    root.rmdir()


def inprocess_textual(workspace: Path, fixture: dict, proposal: dict, clock, before_lock=None, retries_already: int = 0):
    """Single-writer entry used by the stale-candidate test. Not a matrix run."""
    prepare_workspace(workspace, fixture)
    return run_textual(
        workspace,
        fixture["filename"],
        fixture["base"],
        proposal,
        patch_for_arm(fixture, proposal, "textual_merge_file"),
        clock,
        0,
        before_lock=before_lock,
        retries_already=retries_already,
    )


def inprocess_file_lock(workspace: Path, fixture: dict, proposal: dict, clock):
    prepare_workspace(workspace, fixture)
    return run_file_lock(workspace, fixture["filename"], proposal, patch_for_arm(fixture, proposal, "file_lock"), clock, 0)


def body_sha(body: str) -> str:
    return sha256_text(body)


def release_workspace(root: Path) -> None:
    if (root / "FORENSIC.json").exists():
        return
    _remove(root)
