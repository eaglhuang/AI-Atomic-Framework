#!/usr/bin/env python3
"""Build classifier v8 candidate JSONL from the sealed 2024-2025 pairs plus public holdout snapshots.

Population follows the frozen mining rules that the prereg cites (overlap, common source
file, default branch, 1..12 source files, <=400 lines). Drift is kept and handed to
classifier v8. Flask and requests are explicit held-out-project.
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from itertools import combinations
from pathlib import Path

SEALED = Path("/workspace/research/paper-v2/benchmark-trials/2026-10-09-hist-mining/out")
SNAPSHOTS = Path("/tmp/hist-v2-work/snapshots")
MIRRORS = Path("/tmp/hist-v2-mirrors")
OUT = Path("/tmp/hist-v2-work/candidates")

PROJECTS = {
    "django": {"url": "https://github.com/django/django.git", "branch": "main", "holdout_project": False},
    "sympy": {"url": "https://github.com/sympy/sympy.git", "branch": "master", "holdout_project": False},
    "xarray": {"url": "https://github.com/pydata/xarray.git", "branch": "main", "holdout_project": False},
    "pytest": {"url": "https://github.com/pytest-dev/pytest.git", "branch": "main", "holdout_project": False},
    "sphinx": {"url": "https://github.com/sphinx-doc/sphinx.git", "branch": "master", "holdout_project": False},
    "fastapi": {"url": "https://github.com/fastapi/fastapi.git", "branch": "master", "holdout_project": False},
    "flask": {"url": "https://github.com/pallets/flask.git", "branch": "main", "holdout_project": True},
    "requests": {"url": "https://github.com/psf/requests.git", "branch": "main", "holdout_project": True},
}

import re

TEST_RE = re.compile(r"(^|/)(tests?|testing)/|(^|/)[^/]*_test\.py$|(^|/)test_[^/]*\.py$|(^|/)conftest\.py$")
DOC_RE = re.compile(
    r"(^|/)(docs?)/|\.rst$|\.md$|\.txt$|(^|/)\.github/|(^|/)changelog[^/]*$|(^|/)release[^/]*notes[^/]*$|(^|/)AUTHORS[^/]*$",
    re.I,
)
VEND_RE = re.compile(r"(^|/)(vendor|_vendor|vendored|third_party|externals|extern)/")
GEN_EXT_RE = re.compile(r"\.min\.js$|\.lock$|\.po$|\.mo$")


def classify_path(path: str) -> str:
    if TEST_RE.search(path):
        return "test"
    if DOC_RE.search(path):
        return "doc"
    if VEND_RE.search(path):
        return "vendored"
    if GEN_EXT_RE.search(path):
        return "generated"
    if path.endswith(".py"):
        return "source"
    return "other"


def git(repo: Path, *args: str, check: bool = True, text: bool = True):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=text)
    if check and result.returncode != 0:
        raise RuntimeError(f"git {args[0]}: {result.stderr[:300]}")
    return result


def has_commit(repo: Path, sha: str) -> bool:
    return bool(sha) and git(repo, "cat-file", "-e", f"{sha}^{{commit}}", check=False).returncode == 0


def ensure_commit(repo: Path, url: str, sha: str, number: int | None = None) -> bool:
    if has_commit(repo, sha):
        return True
    if number is not None:
        git(
            repo,
            "fetch",
            "--no-tags",
            "-q",
            url,
            f"+refs/pull/{number}/head:refs/pr/{number}",
            check=False,
        )
    if not has_commit(repo, sha):
        git(repo, "fetch", "--no-tags", "-q", url, sha, check=False)
    return has_commit(repo, sha)


def blob_text(repo: Path, rev: str, path: str):
    result = git(repo, "cat-file", "-p", f"{rev}:{path}", check=False, text=False)
    return result.stdout if result.returncode == 0 else None


def generated_header(blob: bytes) -> bool:
    head = blob.decode("utf-8", "replace").splitlines()[:5]
    return any(("generated" in line.lower()) or ("DO NOT EDIT" in line) for line in head)


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def overlap(left: dict, right: dict) -> bool:
    return iso(left["created_at"]) <= iso(right["merged_at"]) and iso(right["created_at"]) <= iso(left["merged_at"])


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def prefetch(repo: Path, url: str, snapshots: list[dict]) -> None:
    missing = [pr["number"] for pr in snapshots if not has_commit(repo, pr["head_sha"])]
    for offset in range(0, len(missing), 80):
        batch = missing[offset : offset + 80]
        specs = [f"+refs/pull/{number}/head:refs/pr/{number}" for number in batch]
        git(repo, "fetch", "--no-tags", "-q", url, *specs, check=False)
        print(f"prefetch {repo.name} {offset}+{len(batch)}", flush=True)


def eligibility_from_snapshot(project: str, snapshots: list[dict]) -> tuple[dict[int, dict], list[dict]]:
    spec = PROJECTS[project]
    repo = MIRRORS / f"{project}.git"
    url = spec["url"]
    prefetch(repo, url, snapshots)
    eligible: dict[int, dict] = {}
    rows = []
    for pr in sorted(snapshots, key=lambda row: row["number"]):
        row = {
            "number": pr["number"],
            "created_at": pr["created_at"],
            "merged_at": pr["merged_at"],
            "head_sha": pr["head_sha"],
            "merge_commit_sha": pr["merge_commit_sha"],
            "base_ref": pr["base_ref"],
            "n_commits": pr["n_commits"],
        }

        def done(reason: str, **extra):
            row.update(extra)
            row["reason"] = reason
            rows.append(dict(row))

        if pr["base_ref"] != spec["branch"]:
            done("non-default-base")
            continue
        head, landing = pr["head_sha"], pr["merge_commit_sha"]
        if not ensure_commit(repo, url, head, pr["number"]):
            done("head-unavailable")
            continue
        if not ensure_commit(repo, url, landing):
            done("landing-unavailable")
            continue
        if head == landing:
            count = int(pr["n_commits"])
            mb = git(repo, "rev-parse", f"{head}~{count}", check=False).stdout.strip() if count >= 1 else ""
            span = git(repo, "rev-list", "--count", f"{mb}..{head}", check=False).stdout.strip() if mb else ""
            merges = git(repo, "rev-list", "--merges", f"{mb}..{head}", check=False).stdout.strip() if mb else "x"
            if not mb or span != str(count) or merges:
                done("ff-nonlinear")
                continue
            row["mb_rule"] = "ff-first-parent-N"
        else:
            parent = git(repo, "rev-parse", f"{landing}^1", check=False).stdout.strip()
            if not parent:
                done("landing-no-parent")
                continue
            mb = git(repo, "merge-base", head, parent, check=False).stdout.strip()
            if not mb:
                done("no-merge-base")
                continue
            row["mb_rule"] = "prereg-landing-parent"
        if mb == head:
            done("head-already-in-base", mb=mb)
            continue
        row["mb"] = mb
        numstat = git(repo, "diff", "--no-renames", "--numstat", "--diff-algorithm=histogram", mb, head).stdout.splitlines()
        raw = git(repo, "diff", "--no-renames", "--raw", mb, head).stdout.splitlines()
        counts = {}
        for line in numstat:
            added, deleted, path = line.split("\t", 2)
            counts[path] = (added, deleted)
        sources, tests, bad = [], [], None
        for line in raw:
            meta, path = line.split("\t", 1)
            old_mode, new_mode, _old, _new, status = meta[1:].split()
            kind = classify_path(path)
            if kind == "source":
                added, deleted = counts.get(path, ("-", "-"))
                if added == "-":
                    kind = "binary"
            if kind == "source":
                if status == "D":
                    bad = "source-file-deleted"
                    break
                if old_mode != "000000" and new_mode != "000000" and old_mode != new_mode:
                    bad = "mode-change"
                    break
                if new_mode == "160000" or old_mode == "160000":
                    bad = "submodule"
                    break
                if status == "M":
                    blob = blob_text(repo, mb, path)
                    try:
                        blob.decode("utf-8")
                    except Exception:
                        bad = "base-not-utf8"
                        break
                    if generated_header(blob):
                        continue
                sources.append({"path": path, "added": int(added), "deleted": int(deleted)})
            elif kind == "test" and new_mode != "160000":
                tests.append(path)
        if bad:
            done(bad)
            continue
        lines = sum(item["added"] + item["deleted"] for item in sources)
        row.update(src_files=[item["path"] for item in sources], test_files=tests, src_lines=lines)
        if not 1 <= len(sources) <= 12:
            done("src-file-count")
            continue
        if lines > 400:
            done("src-lines-gt-400")
            continue
        done("eligible")
        eligible[pr["number"]] = row
    return eligible, rows


def patch_row(pr: dict) -> dict:
    return {"pr": pr["number"], "mb": pr["mb"], "head": pr["head_sha"], "merged_at": pr["merged_at"]}


def emit_pair(project: str, left: dict, right: dict, targets: list[str], explicit: str | None, origin: str) -> list[dict]:
    prs = sorted((left, right), key=lambda row: row["number"])
    rows = []
    base_row = {
        "project": project,
        "patches": [patch_row(prs[0]), patch_row(prs[1])],
        "origin": origin,
    }
    if explicit:
        base_row["set"] = explicit
    if not targets:
        rows.append(dict(base_row))
        return rows
    for target in targets:
        row = dict(base_row)
        row["patches"] = list(base_row["patches"])
        row["target_file"] = target
        rows.append(row)
    return rows


def common_targets(repo: Path, left: dict, right: dict, base: str | None) -> list[str]:
    shared = sorted(set(left["src_files"]) & set(right["src_files"]))
    if base is None:
        return shared
    return [path for path in shared if git(repo, "cat-file", "-e", f"{base}:{path}", check=False).returncode == 0] or shared


def sealed_rows(project: str, eligible: dict[int, dict]) -> list[dict]:
    repo = MIRRORS / f"{project}.git"
    rows = []
    for pair in load_jsonl(SEALED / project / "candidates.jsonl"):
        left = eligible[int(pair["prA"])]
        right = eligible[int(pair["prB"])]
        targets = pair.get("common_files")
        if not targets:
            targets = common_targets(repo, left, right, pair.get("base"))
        rows.extend(emit_pair(project, left, right, list(targets), None, f"sealed-2026-10-09:{pair['reason']}"))
    return rows


def fresh_pairs(project: str, eligible: dict[int, dict], known_pairs: set[tuple[int, int]]) -> list[dict]:
    repo = MIRRORS / f"{project}.git"
    explicit = "held-out-project" if PROJECTS[project]["holdout_project"] else None
    people = sorted(eligible.values(), key=lambda row: row["number"])
    rows = []
    for left, right in combinations(people, 2):
        key = (left["number"], right["number"])
        if key in known_pairs:
            continue
        if not overlap(left, right):
            continue
        shared = sorted(set(left["src_files"]) & set(right["src_files"]))
        if not shared:
            continue
        base = git(repo, "merge-base", left["mb"], right["mb"], check=False).stdout.strip()
        present = [path for path in shared if base and git(repo, "cat-file", "-e", f"{base}:{path}", check=False).returncode == 0]
        rows.extend(emit_pair(project, left, right, present or shared, explicit, "public-window"))
    return rows


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    selected = sys.argv[1:] or list(PROJECTS)
    for project in selected:
        sealed_eligible = {}
        known = set()
        rows: list[dict] = []
        if not PROJECTS[project]["holdout_project"]:
            for row in load_jsonl(SEALED / project / "pr_eligibility.jsonl"):
                if row.get("reason") == "eligible":
                    sealed_eligible[int(row["number"])] = row
            for pair in load_jsonl(SEALED / project / "candidates.jsonl"):
                known.add((int(pair["prA"]), int(pair["prB"])))
            rows.extend(sealed_rows(project, sealed_eligible))
        snapshot_path = SNAPSHOTS / f"{project}.jsonl"
        fresh_eligible = {}
        eligibility_rows = []
        if snapshot_path.exists():
            fresh_eligible, eligibility_rows = eligibility_from_snapshot(project, load_jsonl(snapshot_path))
            (OUT / f"{project}.eligibility.jsonl").write_text(
                "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in eligibility_rows),
                encoding="utf-8",
            )
        combined = dict(sealed_eligible)
        combined.update(fresh_eligible)
        added = fresh_pairs(project, combined if not PROJECTS[project]["holdout_project"] else fresh_eligible, known)
        rows.extend(added)
        dest = OUT / f"{project}.jsonl"
        with dest.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        print(
            f"{project} candidates={len(rows)} sealed_prs={len(sealed_eligible)} "
            f"fresh_eligible={len(fresh_eligible)} added_rows={len(added)}",
            flush=True,
        )
    print("BUILD_CANDIDATES_DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
