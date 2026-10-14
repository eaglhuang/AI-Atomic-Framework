"""Pin checks. A failure returns reasons and writes nothing."""

import hashlib
import re
import subprocess
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_pins(repo: Path, pins: dict) -> list[str]:
    failures: list[str] = []
    failures.extend(_sealed_dir(repo, pins["prereg_dir"], pins["prereg_sha256sums_sha256"], "prereg"))
    failures.extend(_rules(repo, pins))
    failures.extend(_sealed_dir(repo, pins["harness_dir"], pins["harness_sha256sums_sha256"], "harness"))
    failures.extend(_core(repo, pins))
    return failures


def _sealed_dir(repo: Path, rel: str, expected_sums: str, label: str) -> list[str]:
    directory = repo / rel
    sums = directory / "SHA256SUMS"
    script = directory / "verify.sh"
    if not script.is_file() or not sums.is_file():
        return [f"{label}: verify.sh or SHA256SUMS missing at {rel}"]
    observed = sha256_file(sums)
    failures = []
    if observed != expected_sums:
        failures.append(f"{label}: SHA256SUMS sha256 {observed} != {expected_sums}")
    proc = subprocess.run(
        ["sh", str(script), str(directory)],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        detail = (proc.stdout + proc.stderr).strip() or f"exit {proc.returncode}"
        failures.append(f"{label}: verify.sh failed: {detail}")
    return failures


def _rules(repo: Path, pins: dict) -> list[str]:
    path = repo / pins["classifier_rules"]
    if not path.is_file():
        return [f"classifier: RULES.md missing at {pins['classifier_rules']}"]
    observed = sha256_file(path)
    expected = pins["classifier_rules_sha256"]
    failures = []
    if observed != expected:
        failures.append(f"classifier: RULES.md sha256 {observed} != {expected}")
    sidecar = path.parent / "RULES.sha256"
    if not sidecar.is_file():
        failures.append("classifier: RULES.sha256 missing")
    else:
        recorded = sidecar.read_text(encoding="utf-8").split()[0]
        if recorded != expected:
            failures.append(f"classifier: RULES.sha256 records {recorded} != {expected}")
    return failures


def _core(repo: Path, pins: dict) -> list[str]:
    sha = pins["core_merge_sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        return [f"core: merge sha is not 40 hex digits: {sha}"]
    rev = subprocess.run(
        ["git", "rev-parse", "--verify", f"{sha}^{{commit}}"],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    if rev.returncode != 0 or rev.stdout.strip() != sha:
        return [f"core: merge {sha} is not a commit in this repository"]
    failures = []
    ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], cwd=repo)
    if ancestor.returncode != 0:
        failures.append(f"core: merge {sha} is not an ancestor of HEAD")
    for rel in pins["core_paths"]:
        status = subprocess.run(
            ["git", "status", "--porcelain", "--", rel],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        if status.stdout.strip():
            failures.append(f"core: path dirty: {rel}")
        diff = subprocess.run(["git", "diff", "--quiet", sha, "HEAD", "--", rel], cwd=repo)
        if diff.returncode != 0:
            failures.append(f"core: path differs from {sha}: {rel}")
    return failures
