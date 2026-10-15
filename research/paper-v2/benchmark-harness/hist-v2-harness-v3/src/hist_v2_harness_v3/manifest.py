"""One manifest per fixture run. Raw events stay with the run directory."""

import json
import platform
import subprocess
from pathlib import Path

from .digest import sha256_file, sha256_text
from .paths import repo_root


def build_manifest(fixture, arm, seed, order, inter_arrival_ms, body, results, workspace: Path) -> dict:
    root = repo_root()
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    porcelain = subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True)
    lock = root / "package-lock.json"
    events = []
    events_path = workspace / "events.jsonl"
    if events_path.exists():
        for line in events_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                events.append(json.loads(line))
    for result in results:
        events.extend(result.events)
    node = subprocess.check_output(["node", "--version"], cwd=root, text=True).strip()
    return {
        "schema": "hist-v2-harness-manifest/2",
        "formal_run": False,
        "git_head": head,
        "dirty": bool(porcelain.strip()),
        "dirty_entries": [line for line in porcelain.splitlines() if line.strip()],
        "lockfile_sha256": sha256_file(lock) if lock.exists() else None,
        "node": node,
        "python": platform.python_version(),
        "os": platform.platform(),
        "seed": seed,
        "arm": arm,
        "order": order,
        "inter_arrival_ms": inter_arrival_ms,
        "fixture_id": fixture["id"],
        "base_sha256": sha256_text(fixture["base"]),
        "observed_sha256": sha256_text(body),
        "patches": [
            {"proposal_id": result.proposal_id, "patch_sha256": sha256_text(_patch_of(fixture, result.proposal_id))}
            for result in results
        ],
        "proposals": [result.as_dict() for result in results],
        "events": events,
    }


def _patch_of(fixture: dict, proposal_id: int) -> str:
    from .catalog import build_patch

    for proposal in fixture["proposals"]:
        if proposal["id"] == proposal_id:
            return build_patch(fixture, proposal)
    return ""
