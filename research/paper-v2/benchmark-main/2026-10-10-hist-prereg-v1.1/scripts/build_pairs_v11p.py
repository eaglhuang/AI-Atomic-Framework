#!/usr/bin/env python3
"""HIST-PAIRS prereg v1.1 rule §3.1(4a) 'option P' pair builder (FROZEN with prereg v1.1, 2026-10-10).
For a v1.0 'drift' pair where exactly one side X has the partner Y's landing commit inside mb_X (Y landed before X's
base, i.e. X was rebased onto Y), X's final head is replaced by X's pre-rebase head h':
  candidates = beforeCommit of every HeadRefForcePushedEvent of X (time = event time), every PR commit of X and the first
  parent of every merge commit on X (time = committedDate); pick the candidate with the latest time <= Y.merged_at that
  exists locally and does NOT contain Y's landing commit.
  mb' = merge-base(h', landing_Y^1); X patch = diff(mb', h') over X's source files.
All v1.0 PR-level file rules are applied to (mb', h') unchanged (file classes, deleted/mode/submodule/utf8/generated,
1..12 source files, <=400 lines). b' = merge-base(mb', mb_Y); common files must exist at b'; both patches must
`git apply --check` (no fuzz) onto b'; strata O1/O2/O3 by the v1.0 hunk distance; labels writer_version and o1_kind.
Output rows have exactly the v1.0 pairs_eligible schema plus: rule='v1.1-P', writer_version per writer, o1_kind,
semantic_endpoint='not-evaluable-pre-rebase' (prereg v1.1 §3: write-safety endpoint only).
No network access except `git fetch` already done during mining (objects must be present; missing -> 'p-no-pre-landing-head').
usage: build_pairs_v11p.py --repo-dir R.git --project P --mining-out OUT/<project> --out-dir DIR"""
import argparse, json, os, re, subprocess, tempfile, hashlib, collections
from datetime import datetime
ap = argparse.ArgumentParser()
for a in ['repo-dir', 'project', 'mining-out', 'out-dir']: ap.add_argument('--' + a, required=True)
A = ap.parse_args(); G = A.repo_dir; os.makedirs(A.out_dir, exist_ok=True)
def git(*args, input=None, env=None, check=True, text=True):
    r = subprocess.run(['git', '-C', G, *args], input=input, capture_output=True, text=text, env=env)
    if check and r.returncode != 0: raise RuntimeError(f"git {' '.join(args)}: {r.stderr[:500]}")
    return r
# ---- v1.0 rules, verbatim from build_pairs_merge.py ----
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
def pr_files(mb, h):
    """v1.0 PR-level eligibility on (mb, h). returns (reason|None, src_files, test_files, n_lines)"""
    num = git('diff', '--no-renames', '--numstat', '--diff-algorithm=histogram', mb, h).stdout.splitlines()
    raw = git('diff', '--no-renames', '--raw', mb, h).stdout.splitlines()
    numd = {}
    for l in num:
        a, d, path = l.split('\t', 2); numd[path] = (a, d)
    src, tests = [], []
    for l in raw:
        meta, path = l.split('\t', 1)
        om, nm, _, _, st = meta[1:].split()
        cls = classify(path)
        if cls == 'source':
            a, d = numd.get(path, ('-', '-'))
            if a == '-': cls = 'binary'
        if cls == 'source':
            if st == 'D': return 'source-file-deleted', [], [], 0
            if om != '000000' and nm != '000000' and om != nm: return 'mode-change', [], [], 0
            if nm == '160000' or om == '160000': return 'submodule', [], [], 0
            if st == 'M':
                bb = blob_text(mb, path)
                try: bb.decode('utf-8')
                except Exception: return 'base-not-utf8', [], [], 0
                if is_generated_header(bb): continue
            src.append({'path': path, 'added': int(a), 'deleted': int(d)})
        elif cls == 'test':
            if nm == '160000': continue
            tests.append(path)
    n = sum(s['added'] + s['deleted'] for s in src)
    if not (1 <= len(src) <= MAX_SRC_FILES): return 'src-file-count', [s['path'] for s in src], tests, n
    if n > MAX_SRC_LINES: return 'src-lines-gt-400', [s['path'] for s in src], tests, n
    return None, [s['path'] for s in src], tests, n
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
def diff_patch(mb, h, files):
    return git('diff', '--no-renames', '--diff-algorithm=histogram', '--binary', mb, h, '--', *files, text=False).stdout
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
    return parse_hunks(d, path, bl, nl), (base or b'').decode('utf-8')
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
def o1_kind(HA, HB, common):
    """identical iff every distance-0 hunk pair on a common file has the same range and the same post-image"""
    ident, any0 = True, False
    for x in HA:
        for y in HB:
            if x['path'] != y['path'] or x['path'] not in common: continue
            if dist(x, y) == 0:
                any0 = True
                if not (x['start'] == y['start'] and x['end'] == y['end'] and x['post'] == y['post']): ident = False
    return (('identical' if ident else 'divergent') if any0 else None)
def iso(t): return datetime.fromisoformat(t.replace('Z', '+00:00'))
# ---- inputs from the mining generation ----
M = A.mining_out
elig = {r['number']: r for r in map(json.loads, open(f'{M}/pr_eligibility.jsonl')) if r['reason'] == 'eligible'}
cands = [json.loads(l) for l in open(f'{M}/candidates.jsonl')]
hist = json.load(open(f'{M}/v11_pr_history.json'))
drift = sorted([c for c in cands if c['reason'] == 'drift' and c.get('partner_landed_before_base')], key=lambda c: c['pair_id'])
rows, pairs = [], []
for c in drift:
    ra, rb = elig[c['prA']], elig[c['prB']]
    row = {'pair_id': c['pair_id'], 'prA': c['prA'], 'prB': c['prB']}
    def done(p_reason_, **kw): row.update(kw); row["p_reason"] = p_reason_; rows.append(row)
    sides = [(x, y) for x, y in ((ra, rb), (rb, ra)) if git('merge-base', '--is-ancestor', y['merge_commit_sha'], x['mb'], check=False).returncode == 0]
    if len(sides) != 1: done('p-both-or-none-rebased'); continue
    X, Y = sides[0]; tY = iso(Y['merged_at'])
    h = hist.get(str(X['number']), {})
    cand = [(iso(f['t']), f['before']) for f in h.get('force_pushes', []) if f['before']]
    for cm in h.get('commits', []):
        cand.append((iso(cm['t']), cm['oid']))
        if len(cm['parents']) == 2: cand.append((iso(cm['t']), cm['parents'][0]))
    cand = sorted([(t, s) for t, s in cand if t <= tY and has(s) and git('merge-base', '--is-ancestor', Y['merge_commit_sha'], s, check=False).returncode != 0], reverse=True)
    if not cand: done('p-no-pre-landing-head', rebased_pr=X['number']); continue
    hp = cand[0][1]
    mbp = git('merge-base', hp, Y['merge_commit_sha'] + '^1', check=False).stdout.strip()
    if not mbp or mbp == hp: done('p-pre-head-empty', rebased_pr=X['number'], pre_head=hp); continue
    bad, fx, tx_files, nlines = pr_files(mbp, hp)
    if bad: done('p-pre-head-' + bad, rebased_pr=X['number'], pre_head=hp); continue
    common_all = sorted(set(fx) & set(Y['src_files']))
    if not common_all: done('p-pre-head-no-common-file', rebased_pr=X['number'], pre_head=hp); continue
    b = git('merge-base', mbp, Y['mb'], check=False).stdout.strip()
    if not b: done('p-no-shared-base', rebased_pr=X['number'], pre_head=hp); continue
    common = [p for p in common_all if git('cat-file', '-e', f'{b}:{p}', check=False).returncode == 0]
    if not common: done('p-common-file-not-in-base', rebased_pr=X['number'], pre_head=hp); continue
    Xw = {'pr': X['number'], 'mb': mbp, 'head': hp, 'final_head': X['head_sha'], 'landing': X['merge_commit_sha'], 'src_files': fx, 'test_files': tx_files, 'writer_version': 'pre-rebase'}
    Yw = {'pr': Y['number'], 'mb': Y['mb'], 'head': Y['head_sha'], 'final_head': Y['head_sha'], 'landing': Y['merge_commit_sha'], 'src_files': Y['src_files'], 'test_files': Y['test_files'], 'writer_version': 'final'}
    WA, WB = (Xw, Yw) if X['number'] == c['prA'] else (Yw, Xw)
    try:
        for p in set(WA['src_files']) | set(WB['src_files']):
            bt = blob_text(b, p)
            if bt is not None: bt.decode('utf-8')
    except UnicodeDecodeError: done('p-base-not-utf8', rebased_pr=X['number'], pre_head=hp); continue
    pa, pb = diff_patch(WA['mb'], WA['head'], WA['src_files']), diff_patch(WB['mb'], WB['head'], WB['src_files'])
    ta, _ = tmp_index_apply(b, [pa]); tb, _ = tmp_index_apply(b, [pb])
    if ta is None or tb is None: done('p-drift', rebased_pr=X['number'], pre_head=hp, drift_side=''.join(s for s, t in (('A', ta), ('B', tb)) if t is None)); continue
    HA, HB, base_text = [], [], {}
    for p in sorted(WA['src_files']):
        hs, bt = hunks_between(b, ta, p); HA += hs; base_text[p] = bt
    for p in sorted(WB['src_files']):
        hs, bt = hunks_between(b, tb, p); HB += hs; base_text[p] = bt
    dmin = min_dist(HA, HB, common)
    if dmin is None: done('p-no-hunks-on-common-file', rebased_pr=X['number'], pre_head=hp); continue
    gold, _ = tmp_index_apply(b, [pa, pb])
    stratum = stratum_of(dmin)
    clean = True
    for p in common:
        with tempfile.TemporaryDirectory() as td:
            for n, rev in (('cur', ta), ('base', b), ('other', tb)): open(f'{td}/{n}', 'wb').write(blob_text(rev, p) or b'')
            if subprocess.run(['git', 'merge-file', '-p', f'{td}/cur', f'{td}/base', f'{td}/other'], capture_output=True).returncode != 0: clean = False
    pid = c['pair_id']
    for k, hh in enumerate(HA): hh['logical_id'] = f"log:{pid}:{WA['pr']}:{hh['path']}:h{k}"
    for k, hh in enumerate(HB): hh['logical_id'] = f"log:{pid}:{WB['pr']}:{hh['path']}:h{k}"
    ok = o1_kind(HA, HB, common) if stratum == 'O1' else None
    meta = dict(reason='candidate', rule='v1.1-P', base=b, stratum=stratum, min_dist=dmin, common_files=common, git_merge_file_clean=clean,
                gold_apply_clean=gold is not None, n_hunks_A=len(HA), n_hunks_B=len(HB), rebased_pr=X['number'], pre_head=hp, o1_kind=ok,
                semantic_endpoint='not-evaluable-pre-rebase')
    done('p-candidate', **meta)
    def wout(w, H, patch):
        return {'pr': w['pr'], 'mb': w['mb'], 'head': w['head'], 'final_head': w['final_head'], 'landing': w['landing'], 'writer_version': w['writer_version'],
                'hunks': H, 'test_files': w['test_files'], 'code_patch_sha256': hashlib.sha256(patch).hexdigest(),
                'test_patch_sha256': hashlib.sha256(diff_patch(w['mb'], w['head'], w['test_files']) if w['test_files'] else b'').hexdigest()}
    pairs.append({'pair_id': pid, 'prA': c['prA'], 'prB': c['prB'], **meta, 'project': A.project, 'files': sorted(set(WA['src_files']) | set(WB['src_files'])),
                  'base_text': base_text, 'tree_A': ta, 'tree_B': tb, 'tree_gold': gold, 'writers': [wout(WA, HA, pa), wout(WB, HB, pb)]})
with open(f'{A.out_dir}/v11p_rows.jsonl', 'w') as f:
    for r in rows: f.write(json.dumps(r, sort_keys=True) + '\n')
with open(f'{A.out_dir}/v11p_pairs_eligible.jsonl', 'w') as f:
    for p in pairs: f.write(json.dumps(p, sort_keys=True) + '\n')
summ = {'project': A.project, 'drift_partner_landed_pairs': len(drift), 'p_reasons': dict(collections.Counter(r['p_reason'] for r in rows)),
        'strata': dict(collections.Counter(p['stratum'] + ('-' + p['o1_kind'] if p['o1_kind'] else '') for p in pairs))}
json.dump(summ, open(f'{A.out_dir}/v11p_summary.json', 'w'), indent=1, sort_keys=True); print(json.dumps(summ))
