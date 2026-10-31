"""Derive prereg v3 section 6.2 quantities from a normalized PR record.

Pure functions; no I/O. Definitions (draft section 6.2, D3):
- t_start: author date of the first non-merge commit in PR commit order.
  Sensitivity value t_start_min_author = earliest author date of any
  non-merge commit (differs when history was reordered).
- t_write(f): author date of the first non-merge commit (PR order) touching f.
  A rename touches both the old and the new path.
- t_submit: PR created_at (opening the PR = declaring done).
  Sensitivity value t_submit_alt = last non-merge committer date.
- S1: files of the first non-merge commit (primary claim set, D3).
- S2: final PR diff files (perfect foresight, upper bound only).
- S3: directories of S1 (coarse claim, false-alarm upper bound).
- line_timeline: cumulative additions+deletions after each non-merge commit,
  stamped with that commit's author date.
Quality flags are recorded, never used to drop records here; exclusion rules
belong to the frozen prereg.
"""

from __future__ import annotations

import posixpath
from datetime import datetime, timezone


def parse_ts(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _touched(file_entry: dict) -> list[str]:
    paths = [file_entry["path"]]
    prev = file_entry.get("previous_path")
    if prev and prev != file_entry["path"]:
        paths.append(prev)
    return paths


def derive(rec: dict) -> dict:
    commits = rec["commits"]
    own = [c for c in commits if not c["is_merge"]]
    flags: list[str] = []
    out: dict = {
        "t_start": None,
        "t_start_min_author": None,
        "t_submit": rec["created_at"],
        "t_submit_alt": None,
        "first_commit_sha": None,
        "s1_files": [],
        "s2_files": sorted({p for f in rec["pull_files"] for p in _touched(f)}),
        "s3_dirs": [],
        "t_write": {},
        "line_timeline": [],
        "total_lines": 0,
        "dev_seconds": None,
        "n_commits_fetched": len(commits),
        "n_merge_commits": len(commits) - len(own),
        "flags": flags,
    }
    if not own:
        flags.append("no-own-commits")
        return out
    first = own[0]
    out["first_commit_sha"] = first["sha"]
    out["t_start"] = first["author_date"]
    out["t_start_min_author"] = min((c["author_date"] for c in own), key=parse_ts)
    out["t_submit_alt"] = max((c["committer_date"] for c in own), key=parse_ts)
    s1 = sorted({p for f in first["files"] or [] for p in _touched(f)})
    out["s1_files"] = s1
    out["s3_dirs"] = sorted({posixpath.dirname(p) or "." for p in s1})
    t_write: dict[str, str] = {}
    cum = 0
    timeline = []
    for c in own:
        lines = 0
        for f in c["files"] or []:
            lines += f["additions"] + f["deletions"]
            for p in _touched(f):
                t_write.setdefault(p, c["author_date"])
        cum += lines
        timeline.append({"sha": c["sha"], "at": c["author_date"], "lines": lines, "cum_lines": cum})
    out["t_write"] = dict(sorted(t_write.items()))
    out["line_timeline"] = timeline
    out["total_lines"] = cum

    t_start = parse_ts(out["t_start"])
    t_submit = parse_ts(rec["created_at"])
    out["dev_seconds"] = int((t_submit - t_start).total_seconds())

    if out["t_start_min_author"] != out["t_start"]:
        flags.append("author-order-differs")
    if t_start > t_submit:
        flags.append("start-after-submit")
    if any(parse_ts(c["committer_date"]) > t_submit for c in own):
        flags.append("committed-after-submit")
    if out["n_merge_commits"]:
        flags.append("has-merge-commits")
    reported = rec.get("n_commits_reported")
    if reported is not None and reported != len(commits):
        flags.append("commit-count-mismatch")
    if reported is not None and reported > 250:
        flags.append("commits-truncated")
    if rec.get("pull_files_truncated"):
        flags.append("pull-files-truncated")
    if rec.get("commit_files_truncated"):
        flags.append("commit-files-truncated")
    if not set(s1) <= set(out["s2_files"]):
        flags.append("s1-not-subset-of-s2")
    if not first["files"]:
        flags.append("first-commit-empty")
    return out
