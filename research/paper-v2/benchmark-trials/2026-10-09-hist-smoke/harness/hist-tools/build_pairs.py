#!/usr/bin/env python3
"""HIST-PAIRS step 2 (deterministic): PR snapshot + git history -> eligible PRs -> candidate pairs.
Implements SELECTION_RULES.md (sha256-frozen before any run). No network except `git fetch` of
refs/pull/N/head from the public upstream. Usage:
  build_pairs.py --repo-dir django-full.git --search django_pr_search.jsonl --heads django_pull_heads.txt \
                 --project django --out-dir OUT
Outputs: pr_snapshot.jsonl, pr_eligibility.jsonl (every PR + reason code), candidates.jsonl (every pair
considered + reason code), pairs_eligible.jsonl (pairs with full hunk payloads for the harness)."""
import argparse, json, os, re, subprocess, sys, tempfile, hashlib
from datetime import datetime
from itertools import combinations

ap = argparse.ArgumentParser()
for a in ['repo-dir', 'search', 'heads', 'project', 'out-dir']: ap.add_argument('--' + a, required=True)
ap.add_argument('--main-ref', default='refs/heads/main')
ap.add_argument('--skip-fetch', action='store_true')
A = ap.parse_args()
os.makedirs(A.out_dir, exist_ok=True)
G = A.repo_dir

def git(*args, input=None, env=None, check=True, text=True):
    r = subprocess.run(['git', '-C', G, *args], input=input, capture_output=True, text=text, env=env)
    if check and r.returncode != 0: raise RuntimeError(f"git {' '.join(args)}: {r.stderr[:500]}")
    return r

# ---------------- rules (mirrors SELECTION_RULES.md §2) ----------------
WIN_LO, WIN_HI = '2024-01-01T00:00:00Z', '2025-12-31T23:59:59Z'
MAX_SRC_FILES, MAX_SRC_LINES = 12, 400
TEST_RE = re.compile(r'(^|/)(tests?|testing)/|(^|/)[^/]*_test\.py$|(^|/)test_[^/]*\.py$|(^|/)conftest\.py$')
DOC_RE = re.compile(r'(^|/)(docs?)/|\.rst$|\.md$|\.txt$|(^|/)\.github/|(^|/)changelog[^/]*$|(^|/)release[^/]*notes[^/]*$|(^|/)AUTHORS[^/]*$', re.I)
VEND_RE = re.compile(r'(^|/)(vendor|_vendor|vendored|third_party|externals|extern)/')
GEN_EXT_RE = re.compile(r'\.min\.js$|\.lock$|\.po$|\.mo$')
def classify(path):
    if TEST_RE.search(path): return 'test'
    if DOC_RE.search(path): return 'doc'
    if VEND_RE.search(path): return 'vendored'
    if GEN_EXT_RE.search(path): return 'generated'
    if path.endswith('.py'): return 'source'
    return 'other'

def blob_text(rev, path):
    r = git('cat-file', '-p', f'{rev}:{path}', check=False, text=False)
    return r.stdout if r.returncode == 0 else None

def is_generated_header(b):
    head = b.decode('utf-8', 'replace').splitlines()[:5]
    return any(('generated' in l.lower()) or ('DO NOT EDIT' in l) for l in head)

# ---------------- PR snapshot ----------------
heads = {}
for line in open(A.heads):
    sha, ref = line.split()
    m = re.match(r'refs/pull/(\d+)/head$', ref)
    if m: heads[int(m.group(1))] = sha
prs = [json.loads(l) for l in open(A.search)]
prs = [p for p in prs if p['merged_at'] and WIN_LO <= p['merged_at'] <= WIN_HI]
for p in prs: p['head_sha'] = heads.get(p['number'])
if not A.skip_fetch:
    need = [p for p in prs if p['head_sha'] and git('cat-file', '-e', p['head_sha'] + '^{commit}', check=False).returncode != 0]
    for i in range(0, len(need), 150):
        specs = [f"+refs/pull/{p['number']}/head:refs/pr/{p['number']}" for p in need[i:i + 150]]
        git('fetch', '-q', 'https://github.com/django/django.git' if A.project == 'django' else A.project, *specs, check=False)
main_tip = git('rev-parse', A.main_ref).stdout.strip()
snap_meta = {'main_ref': A.main_ref, 'main_tip': main_tip, 'built_at_utc': datetime.utcnow().isoformat() + 'Z'}

elig = {}
rows = []
for p in sorted(prs, key=lambda x: x['number']):
    row = {'number': p['number'], 'created_at': p['created_at'], 'merged_at': p['merged_at'], 'head_sha': p['head_sha']}
    def done(reason, **kw):
        row.update(kw); row['reason'] = reason; rows.append(row)
    h = p['head_sha']
    if not h or git('cat-file', '-e', h + '^{commit}', check=False).returncode != 0: done('head-unavailable'); continue
    if git('merge-base', '--is-ancestor', h, main_tip, check=False).returncode == 0: done('head-in-main-ff'); continue
    mb = git('merge-base', h, main_tip, check=False).stdout.strip()
    if not mb: done('no-merge-base'); continue
    row['mb'] = mb
    ns = git('diff', '--no-renames', '--name-status', '--diff-algorithm=histogram', mb, h).stdout.splitlines()
    num = git('diff', '--no-renames', '--numstat', '--diff-algorithm=histogram', mb, h).stdout.splitlines()
    raw = git('diff', '--no-renames', '--raw', mb, h).stdout.splitlines()
    numd = {}
    for l in num:
        a, d, path = l.split('\t', 2); numd[path] = (a, d)
    src, tests, bad = [], [], None
    for l in raw:
        meta, path = l.split('\t', 1)
        om, nm, _, _, st = meta[1:].split()
        cls = classify(path)
        if cls == 'source':
            a, d = numd.get(path, ('-', '-'))
            if a == '-': cls = 'binary'
        if cls == 'source':
            if st == 'D': bad = 'source-file-deleted'; break
            if om != '000000' and nm != '000000' and om != nm: bad = 'mode-change'; break
            if nm == '160000' or om == '160000': bad = 'submodule'; break
            if st == 'M':
                bb = blob_text(mb, path)
                try: bb.decode('utf-8')
                except Exception: bad = 'base-not-utf8'; break
                if is_generated_header(bb): continue
            src.append({'path': path, 'status': st, 'added': int(a), 'deleted': int(d)})
        elif cls == 'test':
            if nm == '160000': continue
            tests.append(path)
    if bad: done(bad); continue
    n_lines = sum(s['added'] + s['deleted'] for s in src)
    row.update(src_files=[s['path'] for s in src], test_files=tests, src_lines=n_lines)
    if not (1 <= len(src) <= MAX_SRC_FILES): done('src-file-count'); continue
    if n_lines > MAX_SRC_LINES: done('src-lines-gt-400'); continue
    done('eligible'); elig[p['number']] = row

with open(f'{A.out_dir}/pr_snapshot.jsonl', 'w') as f:
    for p in sorted(prs, key=lambda x: x['number']): f.write(json.dumps(p, sort_keys=True) + '\n')
with open(f'{A.out_dir}/pr_eligibility.jsonl', 'w') as f:
    for r in rows: f.write(json.dumps(r, sort_keys=True) + '\n')

# ---------------- pairs ----------------
def tmp_index_apply(base, patches):
    """Apply code patches (bytes) in order onto base tree in a temp index. Returns tree sha or None (+stage)."""
    with tempfile.TemporaryDirectory() as td:
        env = dict(os.environ, GIT_INDEX_FILE=os.path.join(td, 'idx'))
        git('read-tree', base, env=env)
        for i, pt in enumerate(patches):
            pf = os.path.join(td, f'p{i}.patch'); open(pf, 'wb').write(pt)
            r = subprocess.run(['git', '-C', G, 'apply', '--cached', '--check', pf], env=env, capture_output=True)
            if r.returncode != 0: return None, i
            subprocess.run(['git', '-C', G, 'apply', '--cached', pf], env=env, check=True, capture_output=True)
        return git('write-tree', env=env).stdout.strip(), None

def code_patch(r, files):
    return git('diff', '--no-renames', '--diff-algorithm=histogram', '--binary', r['mb'], r['head_sha'], '--', *files, text=False).stdout

def test_patch(r):
    if not r['test_files']: return b''
    return git('diff', '--no-renames', '--diff-algorithm=histogram', '--binary', r['mb'], r['head_sha'], '--', *r['test_files'], text=False).stdout

HUNK_RE = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')
def hunks_between(b, tree, path):
    base = blob_text(b, path); new = blob_text(tree, path)
    bl = (base or b'').decode('utf-8').splitlines(keepends=True)
    nl = (new or b'').decode('utf-8').splitlines(keepends=True)
    out = []
    d = git('diff', '-U0', '--no-renames', '--diff-algorithm=histogram', b, tree, '--', path).stdout
    for l in d.splitlines():
        m = HUNK_RE.match(l)
        if not m: continue
        os_, ol, ns_, nlen = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1), int(m.group(3)), int(m.group(4) if m.group(4) is not None else 1)
        s = os_ if ol == 0 else os_ - 1         # 0-based base index where the hunk starts (insert: before index s)
        ns0 = ns_ if nlen == 0 else ns_ - 1
        pre, post = bl[s:s + ol], nl[ns0:ns0 + nlen]
        kind = 'insert' if ol == 0 else ('delete' if nlen == 0 else 'replace')
        out.append({'path': path, 'start': s, 'end': s + ol, 'kind': kind, 'pre': pre, 'post': post,
                    'ctx_before': bl[max(0, s - 3):s], 'ctx_after': bl[s + ol:s + ol + 3]})
    return out, (base or b'').decode('utf-8'), (new or b'').decode('utf-8')

def dist(h1, h2):
    """0 = intersecting/touching, else number of base lines strictly between the two ranges."""
    a0, a1, b0, b1 = h1['start'], h1['end'], h2['start'], h2['end']
    if a0 < b1 and b0 < a1: return 0
    if a0 == b0: return 0
    gap = max(b0 - a1, a0 - b1)
    return max(0, gap)

def iso(t): return datetime.fromisoformat(t.replace('Z', '+00:00'))
cand_rows, pairs = [], []
E = sorted(elig.values(), key=lambda r: r['number'])
for ra, rb in combinations(E, 2):
    if not (iso(ra['created_at']) <= iso(rb['merged_at']) and iso(rb['created_at']) <= iso(ra['merged_at'])): continue
    common_all = sorted(set(ra['src_files']) & set(rb['src_files']))
    if not common_all: continue  # O0 controls are not built in the Django pilot stage (SELECTION_RULES §3.6)
    pid = f"{A.project}:{ra['number']}_{rb['number']}"
    c = {'pair_id': pid, 'prA': ra['number'], 'prB': rb['number']}
    b = git('merge-base', ra['mb'], rb['mb'], check=False).stdout.strip()
    if not b: c['reason'] = 'no-shared-base'; cand_rows.append(c); continue
    c['base'] = b
    common = [p for p in common_all if git('cat-file', '-e', f'{b}:{p}', check=False).returncode == 0]
    if not common: c['reason'] = 'common-file-not-in-base'; cand_rows.append(c); continue
    try:
        bb = [blob_text(b, p).decode('utf-8') for p in set(ra['src_files']) | set(rb['src_files']) if blob_text(b, p) is not None]
    except UnicodeDecodeError: c['reason'] = 'base-not-utf8'; cand_rows.append(c); continue
    pa, pb = code_patch(ra, ra['src_files']), code_patch(rb, rb['src_files'])
    ta, ia = tmp_index_apply(b, [pa]); tb, ib = tmp_index_apply(b, [pb])
    if ta is None or tb is None: c['reason'] = 'drift'; cand_rows.append(c); continue
    gold, gi = tmp_index_apply(b, [pa, pb])
    files = sorted(set(ra['src_files']) | set(rb['src_files']))
    HA, HB, base_text = [], [], {}
    for p in sorted(ra['src_files']):
        hs, bt, _ = hunks_between(b, ta, p); HA += hs; base_text[p] = bt
    for p in sorted(rb['src_files']):
        hs, bt, _ = hunks_between(b, tb, p); HB += hs; base_text[p] = bt
    dmin = None
    for p in common:
        for x in [h for h in HA if h['path'] == p]:
            for y in [h for h in HB if h['path'] == p]:
                d = dist(x, y); dmin = d if dmin is None else min(dmin, d)
    if dmin is None: c['reason'] = 'no-hunks-on-common-file'; cand_rows.append(c); continue
    stratum = 'O1' if dmin == 0 else ('O2' if dmin <= 3 else 'O3')
    # git merge-file label on each common file
    clean = True
    for p in common:
        with tempfile.TemporaryDirectory() as td:
            for n, rev in (('cur', ta), ('base', b), ('other', tb)):
                open(f'{td}/{n}', 'wb').write(blob_text(rev, p) or b'')
            r = subprocess.run(['git', 'merge-file', '-p', f'{td}/cur', f'{td}/base', f'{td}/other'], capture_output=True)
            if r.returncode != 0: clean = False
    for k, h in enumerate([h for h in HA]): h['logical_id'] = f"log:{pid}:{ra['number']}:{h['path']}:h{k}"
    for k, h in enumerate([h for h in HB]): h['logical_id'] = f"log:{pid}:{rb['number']}:{h['path']}:h{k}"
    c.update(reason='candidate', stratum=stratum, min_dist=dmin, common_files=common, git_merge_file_clean=clean,
             gold_apply_clean=gold is not None, n_hunks_A=len(HA), n_hunks_B=len(HB))
    cand_rows.append(c)
    pairs.append({**c, 'project': A.project, 'files': files, 'base_text': base_text,
                  'tree_A': ta, 'tree_B': tb, 'tree_gold': gold,
                  'writers': [{'pr': ra['number'], 'mb': ra['mb'], 'head': ra['head_sha'], 'hunks': HA, 'test_files': ra['test_files'],
                               'code_patch_sha256': hashlib.sha256(pa).hexdigest(), 'test_patch_sha256': hashlib.sha256(test_patch(ra)).hexdigest()},
                              {'pr': rb['number'], 'mb': rb['mb'], 'head': rb['head_sha'], 'hunks': HB, 'test_files': rb['test_files'],
                               'code_patch_sha256': hashlib.sha256(pb).hexdigest(), 'test_patch_sha256': hashlib.sha256(test_patch(rb)).hexdigest()}]})
with open(f'{A.out_dir}/candidates.jsonl', 'w') as f:
    for c in sorted(cand_rows, key=lambda x: x['pair_id']): f.write(json.dumps(c, sort_keys=True) + '\n')
with open(f'{A.out_dir}/pairs_eligible.jsonl', 'w') as f:
    for pr in sorted(pairs, key=lambda x: x['pair_id']): f.write(json.dumps(pr, sort_keys=True) + '\n')
json.dump(snap_meta, open(f'{A.out_dir}/build_meta.json', 'w'), indent=1, sort_keys=True)
from collections import Counter
print('PRs', len(prs), Counter(r['reason'] for r in rows))
print('candidates', Counter(c['reason'] for c in cand_rows), Counter(p['stratum'] for p in pairs))
