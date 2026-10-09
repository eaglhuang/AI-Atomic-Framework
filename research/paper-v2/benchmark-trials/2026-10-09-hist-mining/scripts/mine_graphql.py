#!/usr/bin/env python3
"""HIST-PAIRS mining v1-merge (2026-10-09): authenticated PR snapshot via GitHub GraphQL search.
Token is read ONLY from env GITHUB_MINING_TOKEN; it is never printed, logged or written.
Window/filters identical to the frozen trial rules: merged PRs, merged_at in 2024-01-01..2025-12-31 (UTC),
monthly windows (each < 1000 results; split to half-months automatically if a window reports > 1000).
Adds the fields prereg §3.1(3) requires: merge_commit_sha, head.sha (headRefOid), base.ref, commit count.
Usage: mine_graphql.py OWNER/REPO OUT.jsonl"""
import json, os, sys, time, urllib.request, urllib.error, datetime as dt
repo, out = sys.argv[1], sys.argv[2]
TOKEN = os.environ['GITHUB_MINING_TOKEN']
Q = """query($q:String!,$after:String){ rateLimit{remaining resetAt}
 search(query:$q,type:ISSUE,first:100,after:$after){ issueCount pageInfo{hasNextPage endCursor}
  nodes{ ... on PullRequest { number title createdAt closedAt mergedAt url author{login}
     baseRefName headRefOid mergeCommit{oid} commits{totalCount} isCrossRepository } } } }"""
def gql(q, after):
    body = json.dumps({'query': Q, 'variables': {'q': q, 'after': after}}).encode()
    for attempt in range(8):
        try:
            req = urllib.request.Request('https://api.github.com/graphql', data=body, headers={
                'Authorization': 'bearer ' + TOKEN, 'User-Agent': 'atm-hist-miner', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.load(r)
            if 'errors' in d: raise RuntimeError(str(d['errors'])[:300])
            return d['data']
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError, TimeoutError) as e:
            msg = getattr(e, 'code', '') or str(e)[:200]
            print(f'retry {attempt} {msg}', file=log, flush=True); time.sleep(10 * (attempt + 1))
    sys.exit('graphql failed repeatedly')
def windows():
    d = dt.date(2024, 1, 1)
    while d <= dt.date(2025, 12, 31):
        nxt = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield d, min(nxt - dt.timedelta(days=1), dt.date(2025, 12, 31)); d = nxt
seen = {}
log = open(out + '.log', 'w')
def run_window(a, b):
    q = f'repo:{repo} is:pr is:merged merged:{a.isoformat()}..{b.isoformat()}'
    after, n = None, 0
    while True:
        d = gql(q, after); s = d['search']
        if after is None and s['issueCount'] >= 1000 and a != b:
            mid = a + (b - a) // 2
            print(f'split {a}..{b} count={s["issueCount"]}', file=log, flush=True)
            run_window(a, mid); run_window(mid + dt.timedelta(days=1), b); return
        for it in s['nodes']:
            if not it: continue
            n += 1
            seen[it['number']] = {'number': it['number'], 'title': it['title'], 'created_at': it['createdAt'],
                'closed_at': it['closedAt'], 'merged_at': it['mergedAt'], 'html_url': it['url'],
                'user': (it.get('author') or {}).get('login'), 'base_ref': it['baseRefName'],
                'head_sha': it['headRefOid'], 'merge_commit_sha': (it.get('mergeCommit') or {}).get('oid'),
                'n_commits': it['commits']['totalCount'], 'cross_repo': it['isCrossRepository']}
        if not s['pageInfo']['hasNextPage']: break
        after = s['pageInfo']['endCursor']
    print(f'{a}..{b} count={s["issueCount"]} got={n} remaining={d["rateLimit"]["remaining"]}', file=log, flush=True)
for a, b in windows(): run_window(a, b)
with open(out, 'w') as f:
    for k in sorted(seen): f.write(json.dumps(seen[k], sort_keys=True) + '\n')
print(repo, len(seen), 'PRs')
