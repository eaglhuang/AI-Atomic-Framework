"""List PRs merged in a fixed [since, until) window via the GitHub search API.

The search query is recorded verbatim with the listing timestamp so the list
can be audited and re-run. GitHub search returns at most 1,000 results; the
listing refuses to proceed if total_count exceeds that or if GitHub reports
incomplete_results, and it keeps only items whose merged_at falls inside the
half-open window (the search qualifier's upper bound is inclusive).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from .derive import parse_ts
from .mine import HOLDOUT_REPOS, HoldoutRefused
from .transport import Transport

SEARCH_CAP = 1000


class ListingError(RuntimeError):
    pass


def query_for(repo: str, since: str, until: str) -> str:
    last = parse_ts(until) - timedelta(seconds=1)
    return f"repo:{repo} is:pr is:merged merged:{since}..{last.strftime('%Y-%m-%dT%H:%M:%SZ')}"


def list_window(transport: Transport, repo: str, since: str, until: str,
                now=lambda: datetime.now(timezone.utc), allow_holdout: bool = False):
    if repo in HOLDOUT_REPOS and not allow_holdout:
        raise HoldoutRefused(f"{repo} is held-out (prereg v3 §6.1)")
    lo, hi = parse_ts(since), parse_ts(until)
    if not lo < hi:
        raise ListingError("since must be before until")
    q = query_for(repo, since, until)
    listed_at = now().strftime("%Y-%m-%dT%H:%M:%SZ")
    items: list = []
    total = None
    incomplete = False
    calls = 0
    for page in range(1, SEARCH_CAP // 100 + 1):
        body = transport.get(f"search/issues?q={quote(q)}&sort=created&order=asc&per_page=100&page={page}")
        calls += 1
        total = body["total_count"]
        incomplete = incomplete or bool(body.get("incomplete_results"))
        if total > SEARCH_CAP:
            raise ListingError(f"total_count {total} exceeds the search cap; narrow the window")
        chunk = body.get("items") or []
        items.extend(chunk)
        if len(items) >= total or len(chunk) < 100:
            break
    if incomplete:
        raise ListingError("GitHub reported incomplete_results; retry later")
    rows, outside = [], []
    seen: set[int] = set()
    for it in items:
        merged = (it.get("pull_request") or {}).get("merged_at")
        n = int(it["number"])
        if n in seen:
            continue
        seen.add(n)
        if not merged or not (lo <= parse_ts(merged) < hi):
            outside.append(n)
            continue
        rows.append({"number": n, "title": it.get("title"), "user": (it.get("user") or {}).get("login"),
                     "created_at": it.get("created_at"), "merged_at": merged,
                     "closed_at": it.get("closed_at"), "html_url": it.get("html_url")})
    rows.sort(key=lambda r: r["number"])
    meta = {"repo": repo, "window": {"since": since, "until_exclusive": until},
            "query": q, "endpoint": "GET /search/issues (sort=created, order=asc, per_page=100)",
            "listed_at": listed_at, "total_count": total, "incomplete_results": incomplete,
            "listed": len(rows), "dropped_outside_window": sorted(outside), "api_calls": calls}
    return rows, meta
