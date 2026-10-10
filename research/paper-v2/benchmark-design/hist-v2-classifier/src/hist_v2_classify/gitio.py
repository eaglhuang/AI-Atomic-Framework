"""Read-only git helpers.

Allowed subcommands are listed in ALLOWED_GIT. The classifier never checks out
a branch, never commits, and never reads benchmark run artifacts. `git apply`
runs in a temporary directory so the source repository index is untouched.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile
from dataclasses import dataclass

from .hunks import parse_hunks

ALLOWED_GIT = frozenset(
    {"cat-file", "diff", "merge-base", "merge-file", "log", "rev-parse", "apply"}
)


class GitFailure(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


def _run(args: list[str], cwd: str | None = None, env: dict | None = None) -> subprocess.CompletedProcess:
    if args[0] == "git":
        command = args[1]
    else:
        command = args[0]
        args = ["git", *args]
    if command not in ALLOWED_GIT:
        raise GitFailure("checkout-failed", f"refusing git subcommand {command}")
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True)


def _repo_git(repo: str, args: list[str]) -> subprocess.CompletedProcess:
    if args[0] not in ALLOWED_GIT:
        raise GitFailure("checkout-failed", f"refusing git subcommand {args[0]}")
    return subprocess.run(["git", "-C", repo, *args], capture_output=True)


def commit_exists(repo: str, sha: str) -> bool:
    if not sha or any(ch.isspace() for ch in sha):
        return False
    result = _repo_git(repo, ["cat-file", "-e", f"{sha}^{{commit}}"])
    return result.returncode == 0


def read_blob(repo: str, rev: str, path: str) -> bytes | None:
    result = _repo_git(repo, ["cat-file", "-p", f"{rev}:{path}"])
    if result.returncode != 0:
        return None
    return result.stdout


def merge_base(repo: str, revs: list[str]) -> str | None:
    result = _repo_git(repo, ["merge-base", *revs])
    if result.returncode != 0:
        return None
    text = result.stdout.decode("utf-8", "replace").strip()
    return text or None


def committer_time(repo: str, sha: str) -> str | None:
    result = _repo_git(repo, ["log", "-1", "--format=%cI", sha])
    if result.returncode != 0:
        return None
    text = result.stdout.decode("utf-8", "replace").strip()
    return text or None


def is_utf8_text(blob: bytes | None) -> bool:
    if blob is None:
        return True
    if b"\0" in blob:
        return False
    try:
        blob.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


@dataclass
class PathChange:
    status: str
    src: str
    dst: str


def name_status(repo: str, left: str, right: str) -> list[PathChange]:
    result = _repo_git(
        repo,
        [
            "diff",
            "--name-status",
            "--find-renames",
            "--diff-algorithm=histogram",
            left,
            right,
        ],
    )
    if result.returncode not in (0, 1):
        raise GitFailure("checkout-failed", _err(result))
    changes = []
    for line in result.stdout.decode("utf-8", "replace").splitlines():
        parts = line.split("\t")
        if not parts:
            continue
        code = parts[0]
        if code.startswith(("R", "C")) and len(parts) >= 3:
            changes.append(PathChange(code[0], parts[1], parts[2]))
        elif len(parts) >= 2:
            changes.append(PathChange(code[0], parts[1], parts[1]))
    return changes


def touched_paths(changes: list[PathChange]) -> set[str]:
    paths = set()
    for change in changes:
        paths.add(change.src)
        paths.add(change.dst)
    return paths


def op_for(changes: list[PathChange], target: str) -> str:
    for change in changes:
        involves = change.src == target or change.dst == target
        if not involves:
            continue
        if change.status == "R":
            return "rename"
        if change.status == "C" and change.dst == target and change.src != target:
            return "create"
        if change.status == "A":
            return "create"
        if change.status == "D":
            return "delete"
        if change.status in ("M", "T"):
            return "modify"
    return "absent"


def diff_path(repo: str, left: str, right: str, path: str) -> bytes:
    result = _repo_git(
        repo,
        [
            "diff",
            "--no-renames",
            "--diff-algorithm=histogram",
            "--binary",
            left,
            right,
            "--",
            path,
        ],
    )
    if result.returncode not in (0, 1):
        raise GitFailure("checkout-failed", _err(result))
    return result.stdout


def diff_names(repo: str, left: str, right: str) -> list[str]:
    result = _repo_git(
        repo,
        ["diff", "--name-only", "--find-renames", "--diff-algorithm=histogram", left, right],
    )
    if result.returncode not in (0, 1):
        raise GitFailure("checkout-failed", _err(result))
    return [line for line in result.stdout.decode("utf-8", "replace").splitlines() if line]


def apply_diff(diff: bytes, base_bytes: bytes | None, path: str) -> tuple[bool, bytes | None]:
    """Apply a single-file diff onto base bytes. Returns (ok, resulting bytes).

    Resulting bytes are None when the file is absent after a successful apply.
    """
    if diff == b"":
        return True, base_bytes
    with tempfile.TemporaryDirectory(prefix="hist-v2-apply-") as temp:
        dest = os.path.join(temp, path)
        parent = os.path.dirname(dest)
        if parent:
            os.makedirs(parent, exist_ok=True)
        if base_bytes is not None:
            with open(dest, "wb") as handle:
                handle.write(base_bytes)
        patch = os.path.join(temp, "change.diff")
        with open(patch, "wb") as handle:
            handle.write(diff)
        checked = _run(["apply", "--check", patch], cwd=temp)
        if checked.returncode != 0:
            return False, None
        applied = _run(["apply", patch], cwd=temp)
        if applied.returncode != 0:
            return False, None
        if not os.path.exists(dest):
            return True, None
        with open(dest, "rb") as handle:
            return True, handle.read()


def hunks_between(base: bytes | None, new: bytes | None, path: str) -> list[dict]:
    base_bytes = b"" if base is None else base
    new_bytes = b"" if new is None else new
    if base_bytes == new_bytes:
        return []
    with tempfile.TemporaryDirectory(prefix="hist-v2-hunk-") as temp:
        base_path = os.path.join(temp, "base")
        new_path = os.path.join(temp, "new")
        with open(base_path, "wb") as handle:
            handle.write(base_bytes)
        with open(new_path, "wb") as handle:
            handle.write(new_bytes)
        result = _run(
            [
                "diff",
                "--no-index",
                "--diff-algorithm=histogram",
                "-U0",
                "--",
                base_path,
                new_path,
            ],
            cwd=temp,
        )
        if result.returncode not in (0, 1):
            raise GitFailure("checkout-failed", _err(result))
        text = result.stdout.decode("utf-8", "replace")
        hunks = parse_hunks(text)
        for hunk in hunks:
            hunk["path"] = path
        return hunks


class GitMerger:
    """git merge-file with a content cache. No union/ours/theirs flags."""

    def __init__(self) -> None:
        self.cache: dict[tuple[str, str, str], tuple[int, bytes]] = {}

    def merge_file(self, current: bytes, base: bytes, other: bytes) -> tuple[int, bytes]:
        key = (_sha(current), _sha(base), _sha(other))
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        with tempfile.TemporaryDirectory(prefix="hist-v2-merge-") as temp:
            cur = os.path.join(temp, "cur")
            anc = os.path.join(temp, "base")
            oth = os.path.join(temp, "other")
            for path, blob in ((cur, current), (anc, base), (oth, other)):
                with open(path, "wb") as handle:
                    handle.write(blob)
            result = _run(
                ["merge-file", "-p", "-L", "cur", "-L", "base", "-L", "other", cur, anc, oth]
            )
        outcome = (result.returncode, result.stdout)
        if _merge_error(result.returncode, result.stderr):
            outcome = (result.returncode if result.returncode else 255, result.stdout)
        self.cache[key] = outcome
        return outcome


def merge_is_clean(rc: int) -> bool:
    return rc == 0


def merge_is_conflict(rc: int, _stdout: bytes = b"") -> bool:
    return 0 < rc < 128


def _merge_error(rc: int, stderr: bytes) -> bool:
    if rc < 0 or rc >= 128:
        return True
    text = stderr.lower()
    return rc > 0 and (b"fatal:" in text or b"error:" in text)


def _sha(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def _err(result: subprocess.CompletedProcess) -> str:
    return result.stderr.decode("utf-8", "replace")[:500]
