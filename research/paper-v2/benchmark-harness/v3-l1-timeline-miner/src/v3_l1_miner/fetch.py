"""Fetch one PR's raw timeline from the GitHub REST API.

Calls per PR: 1 (pull) + pages of pull commits (<=250 commits, API cap)
+ pages of pull files + one `commits/<sha>` page per non-merge commit.
Merge commits inside a PR branch (e.g. "merge main into branch") are kept in
the commit list but their files are NOT fetched: GitHub diffs them against the
first parent, so their file list contains upstream work that the PR author did
not write.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .transport import Transport

PULL_COMMITS_CAP = 250
PER_PAGE_COMMITS = 100
PER_PAGE_FILES = 100
COMMIT_FILES_PAGE = 300  # commits/<sha> returns at most 300 files per page
MAX_FILE_PAGES = 10


@dataclass
class RawPull:
    repo: str
    number: int
    pull: dict
    commits: list
    pull_files: list
    commit_files: dict  # sha -> list of file dicts (non-merge commits only)
    calls: int
    pull_files_truncated: bool
    commit_files_truncated: list  # shas whose file list hit the page cap


def _paged(transport: Transport, base: str, per_page: int, max_pages: int) -> tuple[list, int, bool]:
    out: list = []
    calls = 0
    sep = "&" if "?" in base else "?"
    for page in range(1, max_pages + 1):
        chunk = transport.get(f"{base}{sep}per_page={per_page}&page={page}")
        calls += 1
        if not isinstance(chunk, list):
            raise ValueError(f"expected list from {base}")
        out.extend(chunk)
        if len(chunk) < per_page:
            return out, calls, False
    return out, calls, True


def fetch_pull(transport: Transport, repo: str, number: int,
               on_call: Callable[[], None] | None = None) -> RawPull:
    calls = 0
    pull = transport.get(f"repos/{repo}/pulls/{number}")
    calls += 1
    commits, c, _ = _paged(transport, f"repos/{repo}/pulls/{number}/commits",
                           PER_PAGE_COMMITS, PULL_COMMITS_CAP // PER_PAGE_COMMITS + 1)
    calls += c
    pull_files, c, pf_trunc = _paged(transport, f"repos/{repo}/pulls/{number}/files",
                                     PER_PAGE_FILES, 30)
    calls += c
    commit_files: dict[str, list] = {}
    truncated: list[str] = []
    for item in commits:
        if len(item.get("parents") or []) > 1:
            continue
        sha = item["sha"]
        files: list = []
        for page in range(1, MAX_FILE_PAGES + 1):
            path = f"repos/{repo}/commits/{sha}" + ("" if page == 1 else f"?page={page}")
            body = transport.get(path)
            calls += 1
            chunk = body.get("files") or []
            files.extend(chunk)
            if len(chunk) < COMMIT_FILES_PAGE:
                break
        else:
            truncated.append(sha)
        commit_files[sha] = files
        if on_call:
            on_call()
    return RawPull(repo, number, pull, commits, pull_files, commit_files, calls,
                   pf_trunc, truncated)


def _file_entry(f: dict) -> dict:
    e = {
        "path": f["filename"],
        "status": f.get("status"),
        "additions": int(f.get("additions") or 0),
        "deletions": int(f.get("deletions") or 0),
    }
    if f.get("previous_filename"):
        e["previous_path"] = f["previous_filename"]
    return e


def normalize(raw: RawPull) -> dict:
    """Raw API bodies -> the `raw` part of a timeline record (no derivation)."""
    pull = raw.pull
    commits = []
    for idx, item in enumerate(raw.commits):
        parents = [p["sha"] for p in item.get("parents") or []]
        is_merge = len(parents) > 1
        commits.append({
            "index": idx,
            "sha": item["sha"],
            "author_date": item["commit"]["author"]["date"],
            "committer_date": item["commit"]["committer"]["date"],
            "parents": parents,
            "is_merge": is_merge,
            "files": None if is_merge else [_file_entry(f) for f in raw.commit_files.get(item["sha"], [])],
        })
    return {
        "repo": raw.repo,
        "number": raw.number,
        "created_at": pull["created_at"],
        "merged_at": pull.get("merged_at"),
        "closed_at": pull.get("closed_at"),
        "base_ref": (pull.get("base") or {}).get("ref"),
        "base_sha": (pull.get("base") or {}).get("sha"),
        "head_sha": (pull.get("head") or {}).get("sha"),
        "merge_commit_sha": pull.get("merge_commit_sha"),
        "n_commits_reported": pull.get("commits"),
        "n_changed_files_reported": pull.get("changed_files"),
        "commits": commits,
        "pull_files": [_file_entry(f) for f in raw.pull_files],
        "api_calls": raw.calls,
        "pull_files_truncated": raw.pull_files_truncated,
        "commit_files_truncated": list(raw.commit_files_truncated),
    }
