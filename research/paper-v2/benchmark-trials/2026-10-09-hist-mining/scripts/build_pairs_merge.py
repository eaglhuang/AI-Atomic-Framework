#!/usr/bin/env python3
"""HIST-PAIRS mining v1-merge (2026-10-09). Same selection rules as the frozen trial build_pairs.py
(frozen-trial/, sha256 830cbe2d...), with ONLY these changes, all taken from prereg v0.1 §3.1:
  (1) PR base per prereg §3.1(4): mb_X = git merge-base(head_X, landing_X^1), landing_X = merge_commit_sha
      from the authenticated snapshot (replaces trial deviation 'merge-base(head, main_tip)' and the
      'head-in-main-ff' exclusion). Clarification for PRs landed as-is (head == landing, fast-forward /
      rebase of identical commits): landing^1 would be inside the PR, so mb_X = head~N on first parent,
      N = PR commit count, accepted only if mb..head is exactly N non-merge commits (else 'ff-nonlinear').
  (2) prereg §3.1(2): only PRs whose base branch is the default branch ('non-default-base').
  (3) head.sha from the snapshot (prereg §3.1(3)); fetched via refs/pull/N/head from the public upstream.
Everything else (file classes, 1..12 files, <=400 lines, pairs, b = merge-base(mb_A, mb_B), git apply --check
without fuzz, O1/O2/O3 distances, labels) is byte-for-byte the trial logic.
Diagnostics only (never change selection), for the prereg v1.1 decision:
  - drift pairs: whether the partner had already landed before this PR's base ('partner-landed-before-base'),
    and a 3-way variant X3: each patch rebased onto b with git merge-file (ours=b, base=mb_X, theirs=head_X);
    clean -> stratum under X3, conflict -> 'x3-conflict'.
  - O0 control count (overlapping intervals, no common source file).
Usage: build_pairs_merge.py --repo-dir R.git --snapshot X_pr_snapshot_raw.jsonl --project P --url URL --default-branch B --out-dir OUT"""
import argparse, json, os, re, subprocess, sys, tempfile, hashlib
from datetime import datetime
from itertools import combinations
from collections import Counter

ap = argparse.ArgumentParser()
for a in ['repo-dir', 'snapshot', 'project', 'url', 'default-branch', 'out-dir']: ap.add_argument('--' + a, required=True)
ap.add_argument('--skip-fetch', action='store_true')
A = ap.parse_args()
os.makedirs(A.out_dir, exist_ok=True)
G = A.repo_dir

def git(*args, input=None, env=None, check=True, text=True):
    r = subprocess.run(['git', '-C', G, *args], input=input, capture_output=True, text=text, env=env)
    if check and r.returncode != 0: raise RuntimeError(f"git {' '.join(args)}: {r.stderr[:500]}")
    return r

# ---------------- rules (identical to frozen trial build_pairs.py) ----------------
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
def has(sha): return bool(sha) and git('cat-file', '-e', sha + '^{commit}', check=False).returncode == 0

# ---------------- PR snapshot ----------------
prs = [json.loads(l) for l in open(A.snapshot)]
prs = [p for p in prs if p['merged_at'] and WIN_LO <= p['merged_at'] <= WIN_HI]
fetch_log = []
if not A.skip_fetch:
    need = [p for p in prs if p['base_ref'] == A.default_branch and not has(p['head_sha'])]
    for i in range(0, len(need), 150):
        specs = [f"+refs/pull/{p['number']}/head:refs/pr/{p['number']}" for p in need[i:i + 150]]
        r = git('fetch', '-q', A.url, *specs, check=False); fetch_log.append(('pull-heads', i, r.returncode))
    for p in prs:   # snapshot head may differ from the current refs/pull head (force-push after merge): fetch by sha
        if p['base_ref'] == A.default_branch and not has(p['head_sha']):
            r = git('fetch', '-q', A.url, p['head_sha'], check=False); fetch_log.append(('head-sha', p['number'], r.returncode))
        if p['base_ref'] == A.default_branch and not has(p['merge_commit_sha']):
            r = git('fetch', '-q', A.url, p['merge_commit_sha'], check=False); fetch_log.append(('landing-sha', p['number'], r.returncode))
default_tip = git('rev-parse', f'refs/heads/{A.default_branch}').stdout.strip()
snap_meta = {'default_branch': A.default_branch, 'default_tip': default_tip, 'url': A.url,
             'built_at_utc': datetime.utcnow().isoformat() + 'Z', 'fetch_failures': [f for f in fetch_log if f[2] != 0]}

elig, rows = {}, []
for p in sorted(prs, key=lambda x: x['number']):
    row = {'number': p['number'], 'created_at': p['created_at'], 'merged_at': p['merged_at'], 'head_sha': p['head_sha'],
           'merge_commit_sha': p['merge_commit_sha'], 'base_ref': p['base_ref'], 'n_commits': p['n_commits']}
    def done(reason, **kw):
        row.update(kw); row['reason'] = reason; rows.append(row)
    if p['base_ref'] != A.default_branch: done('non-default-base'); continue
    h, L = p['head_sha'], p['merge_commit_sha']
    if not has(h): done('head-unavailable'); continue
    if not has(L): done('landing-unavailable'); continue
    if h == L:
        n = p['n_commits']
        mb = git('rev-parse', f'{h}~{n}', check=False).stdout.strip() if n >= 1 else ''
        if not mb or git('rev-list', '--count', f'{mb}..{h}').stdout.strip() != str(n) or git('rev-list', '--merges', f'{mb}..{h}').stdout.strip():
            done('ff-nonlinear'); continue
        row['mb_rule'] = 'ff-first-parent-N'
    else:
        lp = git('rev-parse', f'{L}^1', check=False).stdout.strip()
        if not lp: done('landing-no-parent'); continue
        mb = git('merge-base', h, lp, check=False).stdout.strip()
        if not mb: done('no-merge-base'); continue
        row['mb_rule'] = 'prereg-landing-parent'
    if mb == h: done('head-already-in-base', mb=mb); continue
    row['mb'] = mb
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

# ---------------- pairs (identical to trial) ----------------
def tmp_index_apply(base, patches):
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
def parse_hunks(d, path, bl, nl):
    out = []
    for l in d.splitlines():
        m = HUNK_RE.match(l)
        if not m: continue
        os_, ol, ns_, nlen = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1), int(m.group(3)), int(m.group(4) if m.group(4) is not None else 1)
        s = os_ if ol == 0 else os_ - 1
        ns0 = ns_ if nlen == 0 else ns_ - 1
        pre, post = bl[s:s + ol], nl[ns0:ns0 + nlen]
        kind = 'insert' if ol == 0 else ('delete' if nlen == 0 else 'replace')
        out.append({'path': path, 'start': s, 'end': s + ol, 'kind': kind, 'pre': pre, 'post': post,
                    'ctx_before': bl[max(0, s - 3):s], 'ctx_after': bl[s + ol:s + ol + 3]})
    return out
def hunks_between(b, tree, path):
    base = blob_text(b, path); new = blob_text(tree, path)
    bl = (base or b'').decode('utf-8').splitlines(keepends=True)
    nl = (new or b'').decode('utf-8').splitlines(keepends=True)
    d = git('diff', '-U0', '--no-renames', '--diff-algorithm=histogram', b, tree, '--', path).stdout
    return parse_hunks(d, path, bl, nl), (base or b'').decode('utf-8'), (new or b'').decode('utf-8')
def dist(h1, h2):
    a0, a1, b0, b1 = h1['start'], h1['end'], h2['start'], h2['end']
    if a0 < b1 and b0 < a1: return 0
    if a0 == b0: return 0
    return max(0, max(b0 - a1, a0 - b1))
def min_dist(HA, HB, common):
    dm = None
    for p in common:
        for x in [h for h in HA if h['path'] == p]:
            for y in [h for h in HB if h['path'] == p]:
                d = dist(x, y); dm = d if dm is None else min(dm, d)
    return dm
def stratum_of(dm): return 'O1' if dm == 0 else ('O2' if dm <= 3 else 'O3')

# ---- diagnostics only: 3-way rebase of a writer's files onto b (git merge-file ours=b base=mb theirs=head)
def hash_obj(data):
    return subprocess.run(['git', '-C', G, 'hash-object', '-w', '--stdin'], input=data, capture_output=True, check=True).stdout.decode().strip()
def x3_hunks(b, r):
    out = []
    for p in sorted(r['src_files']):
        ours, base, theirs = blob_text(b, p), blob_text(r['mb'], p), blob_text(r['head_sha'], p)
        if ours is None and base is None: new = theirs   # file created by the PR
        elif ours is None: return None, 'x3-file-missing-at-b'
        else:
            with tempfile.TemporaryDirectory() as td:
                for n, data in (('o', ours), ('b', base or b''), ('t', theirs or b'')): open(f'{td}/{n}', 'wb').write(data)
                m = subprocess.run(['git', 'merge-file', '-p', f'{td}/o', f'{td}/b', f'{td}/t'], capture_output=True)
                if m.returncode != 0: return None, 'x3-conflict'
                new = m.stdout
        bo, no = hash_obj(ours or b''), hash_obj(new or b'')
        bl = (ours or b'').decode('utf-8', 'replace').splitlines(keepends=True); nl = (new or b'').decode('utf-8', 'replace').splitlines(keepends=True)
        d = git('diff', '-U0', '--diff-algorithm=histogram', bo, no).stdout
        out += parse_hunks(d, p, bl, nl)
    return out, None

def iso(t): return datetime.fromisoformat(t.replace('Z', '+00:00'))
cand_rows, pairs, o0 = [], [], 0
E = sorted(elig.values(), key=lambda r: r['number'])
for ra, rb in combinations(E, 2):
    if not (iso(ra['created_at']) <= iso(rb['merged_at']) and iso(rb['created_at']) <= iso(ra['merged_at'])): continue
    common_all = sorted(set(ra['src_files']) & set(rb['src_files']))
    if not common_all: o0 += 1; continue
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
    if ta is None or tb is None:
        c['reason'] = 'drift'
        c['drift_side'] = ''.join(s for s, t in (('A', ta), ('B', tb)) if t is None)
        # diagnostics: did the drifting side's base already contain the partner's landing?
        c['partner_landed_before_base'] = any(
            git('merge-base', '--is-ancestor', partner['merge_commit_sha'], me['mb'], check=False).returncode == 0
            for me, partner, t in ((ra, rb, ta), (rb, ra, tb)) if t is None)
        HA3, ea = x3_hunks(b, ra); HB3, eb = x3_hunks(b, rb)
        if ea or eb: c['x3'] = ea or eb
        else:
            dm = min_dist(HA3, HB3, common)
            c['x3'] = 'x3-no-hunks-on-common-file' if dm is None else 'x3-' + stratum_of(dm)
        cand_rows.append(c); continue
    files = sorted(set(ra['src_files']) | set(rb['src_files']))
    HA, HB, base_text = [], [], {}
    for p in sorted(ra['src_files']):
        hs, bt, _ = hunks_between(b, ta, p); HA += hs; base_text[p] = bt
    for p in sorted(rb['src_files']):
        hs, bt, _ = hunks_between(b, tb, p); HB += hs; base_text[p] = bt
    dmin = min_dist(HA, HB, common)
    if dmin is None: c['reason'] = 'no-hunks-on-common-file'; cand_rows.append(c); continue
    gold, gi = tmp_index_apply(b, [pa, pb])
    stratum = stratum_of(dmin)
    clean = True
    for p in common:
        with tempfile.TemporaryDirectory() as td:
            for n, rev in (('cur', ta), ('base', b), ('other', tb)):
                open(f'{td}/{n}', 'wb').write(blob_text(rev, p) or b'')
            r = subprocess.run(['git', 'merge-file', '-p', f'{td}/cur', f'{td}/base', f'{td}/other'], capture_output=True)
            if r.returncode != 0: clean = False
    for k, h in enumerate(HA): h['logical_id'] = f"log:{pid}:{ra['number']}:{h['path']}:h{k}"
    for k, h in enumerate(HB): h['logical_id'] = f"log:{pid}:{rb['number']}:{h['path']}:h{k}"
    c.update(reason='candidate', stratum=stratum, min_dist=dmin, common_files=common, git_merge_file_clean=clean,
             gold_apply_clean=gold is not None, n_hunks_A=len(HA), n_hunks_B=len(HB))
    cand_rows.append(c)
    pairs.append({**c, 'project': A.project, 'files': files, 'base_text': base_text,
                  'tree_A': ta, 'tree_B': tb, 'tree_gold': gold,
                  'writers': [{'pr': ra['number'], 'mb': ra['mb'], 'head': ra['head_sha'], 'landing': ra['merge_commit_sha'], 'hunks': HA, 'test_files': ra['test_files'],
                               'code_patch_sha256': hashlib.sha256(pa).hexdigest(), 'test_patch_sha256': hashlib.sha256(test_patch(ra)).hexdigest()},
                              {'pr': rb['number'], 'mb': rb['mb'], 'head': rb['head_sha'], 'landing': rb['merge_commit_sha'], 'hunks': HB, 'test_files': rb['test_files'],
                               'code_patch_sha256': hashlib.sha256(pb).hexdigest(), 'test_patch_sha256': hashlib.sha256(test_patch(rb)).hexdigest()}]})
with open(f'{A.out_dir}/candidates.jsonl', 'w') as f:
    for c in sorted(cand_rows, key=lambda x: x['pair_id']): f.write(json.dumps(c, sort_keys=True) + '\n')
with open(f'{A.out_dir}/pairs_eligible.jsonl', 'w') as f:
    for pr in sorted(pairs, key=lambda x: x['pair_id']): f.write(json.dumps(pr, sort_keys=True) + '\n')
snap_meta['o0_control_pairs_available'] = o0
snap_meta['pr_reasons'] = dict(Counter(r['reason'] for r in rows))
snap_meta['pair_reasons'] = dict(Counter(c['reason'] for c in cand_rows))
snap_meta['strata'] = dict(Counter(p['stratum'] for p in pairs))
json.dump(snap_meta, open(f'{A.out_dir}/build_meta.json', 'w'), indent=1, sort_keys=True)
print(A.project, 'PRs', len(prs), snap_meta['pr_reasons']); print('pairs', snap_meta['pair_reasons'], snap_meta['strata'], 'O0', o0)
