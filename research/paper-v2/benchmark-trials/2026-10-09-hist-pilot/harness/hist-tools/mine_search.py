#!/usr/bin/env python3
"""HIST-PAIRS step 1: snapshot merged PRs of a GitHub repo in the prereg window via the
unauthenticated GitHub Search API (no token). Writes pr_search_raw.jsonl (one search item per line,
verbatim fields we use) + fetch log. Windows are monthly so each query stays < 1000 results."""
import json, sys, time, urllib.request, datetime as dt
repo, out = sys.argv[1], sys.argv[2]
start, end = dt.date(2024, 1, 1), dt.date(2025, 12, 31)
def windows():
    d = start
    while d <= end:
        nxt = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield d, min(nxt - dt.timedelta(days=1), end)
        d = nxt
seen = {}
log = open(out + '.log', 'a')
for a, b in windows():
    page = 1
    while True:
        q = f"repo:{repo} is:pr is:merged merged:{a.isoformat()}..{b.isoformat()}"
        url = "https://api.github.com/search/issues?" + urllib.parse.urlencode({"q": q, "per_page": 100, "page": page, "sort": "created", "order": "asc"})
        for attempt in range(6):
            try:
                req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "atm-hist-miner"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.load(r); rem = r.headers.get('X-RateLimit-Remaining'); break
            except urllib.error.HTTPError as e:
                print(f"HTTP {e.code} {url}", file=log, flush=True); time.sleep(65)
        else:
            sys.exit("search failed repeatedly")
        items = data.get("items", [])
        print(f"{dt.datetime.utcnow().isoformat()}Z {a}..{b} page={page} n={len(items)} total={data.get('total_count')} remaining={rem}", file=log, flush=True)
        for it in items:
            seen[it["number"]] = {"number": it["number"], "title": it["title"], "created_at": it["created_at"],
                                  "closed_at": it["closed_at"], "merged_at": (it.get("pull_request") or {}).get("merged_at"),
                                  "user": (it.get("user") or {}).get("login"), "html_url": it["html_url"]}
        if data.get("total_count", 0) > 1000: print("WARN >1000 in window", a, b, file=log, flush=True)
        time.sleep(7)
        if len(items) < 100: break
        page += 1
with open(out, "w") as f:
    for n in sorted(seen): f.write(json.dumps(seen[n], sort_keys=True) + "\n")
print(len(seen), "PRs")
