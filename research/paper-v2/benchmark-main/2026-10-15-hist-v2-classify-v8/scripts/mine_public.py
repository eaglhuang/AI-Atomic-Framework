#!/usr/bin/env python3
"""List merged PRs from the public search API and read snapshot fields from public HTML.

No Authorization header is sent. If GitHub asks for a token, this process exits 3.
"""

from __future__ import annotations

import calendar
import json
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

OUT = Path("/tmp/hist-v2-work/snapshots")
UA = "hist-v2-public-classifier"
SLEEP_SEARCH = 6.5


REPOS = [
    ("django", "django/django", "2026-01", "2026-09"),
    ("sympy", "sympy/sympy", "2026-01", "2026-09"),
    ("xarray", "pydata/xarray", "2026-01", "2026-09"),
    ("pytest", "pytest-dev/pytest", "2026-01", "2026-09"),
    ("sphinx", "sphinx-doc/sphinx", "2026-01", "2026-09"),
    ("fastapi", "fastapi/fastapi", "2026-01", "2026-09"),
    ("flask", "pallets/flask", "2024-01", "2026-09"),
    ("requests", "psf/requests", "2024-01", "2026-09"),
]


def months(start: str, end: str):
    year, month = (int(part) for part in start.split("-"))
    end_year, end_month = (int(part) for part in end.split("-"))
    while (year, month) <= (end_year, end_month):
        last = calendar.monthrange(year, month)[1]
        yield f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last:02d}"
        month += 1
        if month == 13:
            month = 1
            year += 1


def fetch(url: str, accept: str) -> tuple[int, dict, bytes]:
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": UA})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read()
            headers = {key.lower(): value for key, value in response.headers.items()}
            return response.status, headers, body
    except urllib.error.HTTPError as exc:
        body = exc.read()
        headers = {key.lower(): value for key, value in exc.headers.items()}
        return exc.code, headers, body


def require_public(status: int, body: bytes, what: str) -> None:
    text = body.decode("utf-8", "replace")
    lowered = text.lower()
    if status in (401, 403) and ("requires authentication" in lowered or "bad credentials" in lowered):
        print(f"TOKEN_REQUIRED {what} http={status}", file=sys.stderr)
        raise SystemExit(3)
    if status == 401:
        print(f"TOKEN_REQUIRED {what} http=401", file=sys.stderr)
        raise SystemExit(3)


def search_month(repo: str, start: str, end: str) -> list[int]:
    numbers: list[int] = []
    page = 1
    while True:
        query = f"repo:{repo} is:pr is:merged merged:{start}..{end}"
        url = "https://api.github.com/search/issues?" + urllib.parse.urlencode(
            {"q": query, "per_page": 100, "page": page}
        )
        status, headers, body = fetch(url, "application/vnd.github+json")
        require_public(status, body, f"search {repo} {start}")
        if status == 403:
            reset = int(headers.get("x-ratelimit-reset") or time.time() + 30)
            wait = max(1, reset - int(time.time()) + 1)
            print(f"search wait {wait}s {repo} {start}", flush=True)
            time.sleep(wait)
            continue
        if status != 200:
            print(f"SEARCH_FAIL {repo} {start} http={status} {body[:200]!r}", file=sys.stderr)
            raise SystemExit(2)
        payload = json.loads(body)
        items = payload.get("items") or []
        numbers.extend(int(item["number"]) for item in items)
        total = int(payload.get("total_count") or 0)
        print(f"search {repo} {start} page={page} got={len(items)} total={total}", flush=True)
        if page * 100 >= total or not items:
            break
        if page >= 10:
            print(f"SEARCH_CAP {repo} {start} total={total}", file=sys.stderr)
            raise SystemExit(2)
        page += 1
        time.sleep(SLEEP_SEARCH)
    return numbers


def parse_pr(html: str) -> dict:
    marker = '<script type="application/json" data-target="react-app.embeddedData">'
    start = html.find(marker)
    if start < 0:
        raise ValueError("embedded data missing")
    start = html.find(">", start) + 1
    end = html.find("</script>", start)
    payload = json.loads(html[start:end])["payload"]
    pr = payload["pullRequestsLayoutRoute"]["pullRequest"]
    if pr.get("state") != "MERGED":
        raise ValueError(f"state {pr.get('state')}")
    author = pr.get("author") or {}
    return {
        "number": int(pr["number"]),
        "created_at": pr["createdTime"],
        "merged_at": pr["mergedTime"],
        "closed_at": pr.get("closedTime"),
        "head_sha": pr["headSha"],
        "merge_commit_sha": pr["mergeCommitSha"],
        "base_ref": pr["baseBranch"],
        "n_commits": int(pr["commitsCount"]),
        "title": pr.get("title") or "",
        "user": author.get("login") or "",
        "state": pr["state"],
    }


def fetch_pr(repo: str, number: int) -> dict:
    url = f"https://github.com/{repo}/pull/{number}"
    delay = 1.0
    for attempt in range(6):
        status, headers, body = fetch(url, "text/html")
        require_public(status, body, f"html {repo}#{number}")
        if status == 200:
            row = parse_pr(body.decode("utf-8", "replace"))
            row["html_url"] = url
            return row
        if status in (429, 403, 502, 503):
            wait = delay
            if headers.get("retry-after"):
                wait = float(headers["retry-after"])
            print(f"html backoff {wait}s {repo}#{number} http={status}", flush=True)
            time.sleep(wait)
            delay = min(delay * 2, 60)
            continue
        print(f"HTML_FAIL {repo}#{number} http={status}", file=sys.stderr)
        raise SystemExit(2)
    print(f"HTML_FAIL {repo}#{number} exhausted", file=sys.stderr)
    raise SystemExit(2)


def _write_snapshot(dest: Path, ordered: list[int], have: dict[int, dict]) -> None:
    lines = [json.dumps(have[number], ensure_ascii=False, sort_keys=True) for number in ordered if number in have]
    dest.write_text("".join(line + "\n" for line in lines), encoding="utf-8")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for project, repo, start, end in REPOS:
        dest = OUT / f"{project}.jsonl"
        have = {}
        if dest.exists():
            for line in dest.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    have[int(row["number"])] = row
        numbers: list[int] = []
        for window_start, window_end in months(start, end):
            found = search_month(repo, window_start, window_end)
            numbers.extend(found)
            time.sleep(SLEEP_SEARCH)
        ordered = sorted(set(numbers))
        print(f"project {project} prs={len(ordered)} already={len(have)}", flush=True)
        missing = [number for number in ordered if number not in have]
        for index, number in enumerate(missing, start=1):
            row = fetch_pr(repo, number)
            have[int(row["number"])] = row
            if index == 1 or index % 25 == 0 or index == len(missing):
                _write_snapshot(dest, ordered, have)
                print(f"html {project} {index}/{len(missing)} #{number}", flush=True)
            time.sleep(0.2)
        _write_snapshot(dest, ordered, have)
        print(f"WROTE {dest} {len(ordered)}", flush=True)
    print("MINE_PUBLIC_DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
