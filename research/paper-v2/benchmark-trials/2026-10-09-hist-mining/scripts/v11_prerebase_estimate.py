#!/usr/bin/env python3
"""DIAGNOSTIC ESTIMATE for a prereg v1.1 proposal (does NOT change any selection; output is an estimate only).
Option P ('pre-rebase head'): for a drift pair where the drifting PR X was rebased/updated after its partner Y landed
(Y's landing is an ancestor of mb_X), replace X's final head by X's last head that does NOT yet contain Y's landing
(i.e. what X looked like while it was really concurrent with Y). Candidate earlier heads of X:
  - beforeCommit of every HeadRefForcePushedEvent (GitHub keeps these objects; fetched by sha),
  - every commit listed on the PR, and the first parent of every merge commit on the PR (merge-from-main).
Pick the candidate with the latest time <= Y.merged_at that does not contain Y's landing (time = force-push
event time for beforeCommits, committedDate for commits). Then mb' = merge-base(h', landing_X^1),
apply the frozen file rules (1..12 source files, <=400 lines), b' = merge-base(mb_Y, mb'), both patches must apply
to b' with git apply --check (no fuzz), and stratify exactly like the frozen rules.
Token only from env GITHUB_MINING_TOKEN (never printed/logged).
usage: v11_prerebase_estimate.py PROJECT OWNER/REPO REPO.git OUTDIR"""
import json, os, sys, re, subprocess, tempfile, time, urllib.request, urllib.error, collections
from datetime import datetime
proj, slug, G, OUT = sys.argv[1:5]
owner, name = slug.split('/')
url = f'https://github.com/{slug}.git'
TOKEN = os.environ['GITHUB_MINING_TOKEN']
sys.argv = [sys.argv[0]]
def git(*a, check=True, text=True, env=None):
    r = subprocess.run(['git', '-C', G, *a], capture_output=True, text=text, env=env)
    if check and r.returncode: raise RuntimeError(' '.join(a) + r.stderr[:300] if text else '')
    return r
def has(s): return bool(s) and git('cat-file', '-e', s + '^{commit}', check=False).returncode == 0
def iso(t): return datetime.fromisoformat(t.replace('Z', '+00:00'))
elig = {r['number']: r for r in map(json.loads, open(f'{OUT}/{proj}/pr_eligibility.jsonl'))}
cands = [json.loads(l) for l in open(f'{OUT}/{proj}/candidates.jsonl')]
drift = [c for c in cands if c['reason'] == 'drift' and c.get('partner_landed_before_base')]
need = sorted({n for c in drift for n in (c['prA'], c['prB'])})
# ---- GraphQL: force-push events + commits for the PRs involved
F = """number commits(first:250){nodes{commit{oid committedDate parents(first:2){nodes{oid}}}}}
 timelineItems(first:100,itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]){nodes{... on HeadRefForcePushedEvent{createdAt beforeCommit{oid} afterCommit{oid}}}}"""
cache = f'{OUT}/{proj}/v11_pr_history.json'
hist = json.load(open(cache)) if os.path.exists(cache) else {}
todo = [n for n in need if str(n) not in hist]
for i in range(0, len(todo), 20):
    chunk = todo[i:i + 20]
    q = 'query{repository(owner:"%s",name:"%s"){%s}}' % (owner, name, ' '.join(f'p{n}:pullRequest(number:{n}){{{F}}}' for n in chunk))
    for att in range(6):
        try:
            req = urllib.request.Request('https://api.github.com/graphql', data=json.dumps({'query': q}).encode(),
                  headers={'Authorization': 'bearer ' + TOKEN, 'User-Agent': 'atm-hist-miner', 'Content-Type': 'application/json'})
            d = json.load(urllib.request.urlopen(req, timeout=120))
            if 'errors' in d and not d.get('data'): raise RuntimeError('gql error')
            break
        except Exception as e:
            time.sleep(10 * (att + 1))
    else: sys.exit('graphql failed')
    for n in chunk:
        pr = (d['data']['repository'] or {}).get(f'p{n}') or {}
        hist[str(n)] = {'commits': [{'oid': x['commit']['oid'], 't': x['commit']['committedDate'], 'parents': [p['oid'] for p in x['commit']['parents']['nodes']]}
                                    for x in (pr.get('commits') or {}).get('nodes', [])],
                        'force_pushes': [{'t': x['createdAt'], 'before': (x.get('beforeCommit') or {}).get('oid'), 'after': (x.get('afterCommit') or {}).get('oid')}
                                         for x in (pr.get('timelineItems') or {}).get('nodes', []) if x]}
json.dump(hist, open(cache, 'w'), indent=0, sort_keys=True)
# ---- fetch missing objects (force-push beforeCommits / PR commits) by sha
missing = sorted({s for h in hist.values() for s in [f['before'] for f in h['force_pushes']] + [c['oid'] for c in h['commits']] if s and not has(s)})
for i in range(0, len(missing), 100): git('fetch', '-q', url, *missing[i:i + 100], check=False)
if missing:
    still = [s for s in missing if not has(s)]
    for s in still: git('fetch', '-q', url, s, check=False)
# ---- frozen file rules (same regexes as build_pairs)
TEST_RE = re.compile(r'(^|/)(tests?|testing)/|(^|/)[^/]*_test\.py$|(^|/)test_[^/]*\.py$|(^|/)conftest\.py$')
DOC_RE = re.compile(r'(^|/)(docs?)/|\.rst$|\.md$|\.txt$|(^|/)\.github/|(^|/)changelog[^/]*$|(^|/)release[^/]*notes[^/]*$|(^|/)AUTHORS[^/]*$', re.I)
VEND_RE = re.compile(r'(^|/)(vendor|_vendor|vendored|third_party|externals|extern)/')
GEN_EXT_RE = re.compile(r'\.min\.js$|\.lock$|\.po$|\.mo$')
def src_files(mb, h):
    out, lines = [], 0
    for l in git('diff', '--no-renames', '--numstat', mb, h).stdout.splitlines():
        a, d, p = l.split('\t', 2)
        if TEST_RE.search(p) or DOC_RE.search(p) or VEND_RE.search(p) or GEN_EXT_RE.search(p) or not p.endswith('.py') or a == '-': continue
        out.append(p); lines += int(a) + int(d)
    return out, lines
def apply_ok(base, patch):
    with tempfile.TemporaryDirectory() as td:
        env = dict(os.environ, GIT_INDEX_FILE=os.path.join(td, 'idx')); git('read-tree', base, env=env)
        pf = os.path.join(td, 'p'); open(pf, 'wb').write(patch)
        if subprocess.run(['git', '-C', G, 'apply', '--cached', '--check', pf], env=env, capture_output=True).returncode: return None
        subprocess.run(['git', '-C', G, 'apply', '--cached', pf], env=env, check=True, capture_output=True)
        return git('write-tree', env=env).stdout.strip()
HUNK_RE = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')
def hunks(b, tree, paths):
    out = []
    for p in paths:
        d = git('diff', '-U0', '--diff-algorithm=histogram', b, tree, '--', p).stdout
        nl = (git('cat-file', '-p', f'{tree}:{p}', check=False, text=False).stdout or b'').decode('utf-8', 'replace').splitlines(True)
        for l in d.splitlines():
            m = HUNK_RE.match(l)
            if m:
                s, ol = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
                ns, nn = int(m.group(3)), int(m.group(4) if m.group(4) is not None else 1)
                s0 = s if ol == 0 else s - 1; n0 = ns if nn == 0 else ns - 1
                out.append((p, s0, s0 + ol, ''.join(nl[n0:n0 + nn])))
    return out
def classify_pair(HA, HB, common):
    dm, ident = None, True
    for (p, a0, a1, pa) in HA:
        for (q, b0, b1, pb) in HB:
            if p != q or p not in common: continue
            d = 0 if ((a0 < b1 and b0 < a1) or a0 == b0) else max(0, max(b0 - a1, a0 - b1))
            if d == 0 and not (a0 == b0 and a1 == b1 and pa == pb): ident = False
            dm = d if dm is None else min(dm, d)
    if dm is None: return 'no-hunks-on-common-file'
    if dm == 0: return 'O1-identical' if ident else 'O1-divergent'
    return 'O2' if dm <= 3 else 'O3'
res, rows = collections.Counter(), []
for c in sorted(drift, key=lambda c: c['pair_id']):
    A_, B_ = elig[c['prA']], elig[c['prB']]
    row = {'pair_id': c['pair_id']}
    # which side(s) contain the partner's landing in their base
    sides = [(x, y) for x, y in ((A_, B_), (B_, A_)) if git('merge-base', '--is-ancestor', y['merge_commit_sha'], x['mb'], check=False).returncode == 0]
    if len(sides) != 1: row['p'] = 'both-or-none-rebased'; res[row['p']] += 1; rows.append(row); continue
    X, Y = sides[0]
    h = hist.get(str(X['number']), {})
    tY = iso(Y['merged_at'])
    cand = [(iso(f['t']), f['before']) for f in h.get('force_pushes', []) if f['before']]
    for cm in h.get('commits', []):
        cand.append((iso(cm['t']), cm['oid']))
        if len(cm['parents']) == 2: cand.append((iso(cm['t']), cm['parents'][0]))
    cand = sorted([(t, s) for t, s in cand if t <= tY and has(s) and git('merge-base', '--is-ancestor', Y['merge_commit_sha'], s, check=False).returncode != 0], reverse=True)
    if not cand: row['p'] = 'no-pre-landing-head'; res[row['p']] += 1; rows.append(row); continue
    hp = cand[0][1]
    lp = git('rev-parse', X['merge_commit_sha'] + '^1').stdout.strip() if X['merge_commit_sha'] != X['head_sha'] else X['mb']
    mbp = git('merge-base', hp, Y['merge_commit_sha'] + '^1', check=False).stdout.strip()
    if not mbp or mbp == hp: row['p'] = 'pre-head-empty'; res[row['p']] += 1; rows.append(row); continue
    fx, nlines = src_files(mbp, hp)
    if not (1 <= len(fx) <= 12) or nlines > 400: row['p'] = 'pre-head-file-rules'; res[row['p']] += 1; rows.append(row); continue
    common = sorted(set(fx) & set(Y['src_files']))
    if not common: row['p'] = 'pre-head-no-common-file'; res[row['p']] += 1; rows.append(row); continue
    bp = git('merge-base', mbp, Y['mb'], check=False).stdout.strip()
    common = [p for p in common if git('cat-file', '-e', f'{bp}:{p}', check=False).returncode == 0]
    px = git('diff', '--no-renames', '--binary', mbp, hp, '--', *fx, text=False).stdout
    py = git('diff', '--no-renames', '--binary', Y['mb'], Y['head_sha'], '--', *Y['src_files'], text=False).stdout
    tx, ty = apply_ok(bp, px), apply_ok(bp, py)
    if tx is None or ty is None or not common: row['p'] = 'pre-head-drift'; res[row['p']] += 1; rows.append(row); continue
    row.update(p=classify_pair(hunks(bp, tx, fx), hunks(bp, ty, Y['src_files']), set(common)), pre_head=hp, rebased_pr=X['number'])
    res[row['p']] += 1; rows.append(row)
with open(f'{OUT}/{proj}/v11_prerebase_estimate.jsonl', 'w') as f:
    for r in rows: f.write(json.dumps(r, sort_keys=True) + '\n')
summary = {'project': proj, 'drift_partner_landed_pairs': len(drift), 'prs_queried': len(need), 'objects_missing_after_fetch': sum(1 for s in missing if not has(s)), 'outcomes': dict(res)}
json.dump(summary, open(f'{OUT}/{proj}/v11_prerebase_summary.json', 'w'), indent=1, sort_keys=True)
print(json.dumps(summary))
