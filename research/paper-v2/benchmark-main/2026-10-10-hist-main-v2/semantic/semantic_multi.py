#!/usr/bin/env python3
"""HIST semantic endpoint (STALE method, prereg §5.6) — multi-project variant of the pilot semantic.py (main run 2026-10-10).
Identical scoring logic; only the test-selection/test-runner functions differ for non-Django projects (pytest -rA on the
test modules touched by U). --project django keeps the pilot runner byte-for-byte (tests/runtests.py).
Every condition runs the SAME test set: union test patch U = test patch A then test patch B (from each PR's
mb..head, test files only), test labels = Django test modules touched by U.
Conditions: b+U, b+A+U, b+B+U (solo: 3 repetitions each -> inconsistent tests = flaky, excluded),
gold = b+A+B (git apply A then B) + U, and every arm final tree (b + the run's final bytes) + U whose
bytes differ from gold (identical bytes reuse gold's result).
F2P_X = tests passing on b+X+U that do not pass on b+U (failing, erroring or not loadable at b). base_valid = F2P_A and F2P_B both non-empty.
Arm-attributed regression (prereg) = fails on arm tree, passes on b+A, b+B and gold.
Gold-relative regression (descriptive) = fails on arm tree, passes on gold.
Dataset-level historical interference = fails on gold, passes on b+A and b+B (never attributed to an arm).
Only evaluated for runs where every intent completed (oracle 'correct'); else 'not-evaluable'.
usage: semantic.py --repo django-full.git --pairs pairs.jsonl --runs BATCH_DIR --out OUT.json [--jobs 3]"""
import argparse, concurrent.futures as cf, hashlib, json, os, re, shutil, subprocess, tempfile, time
ap = argparse.ArgumentParser()
ap.add_argument('--repo'); ap.add_argument('--project', default='django'); ap.add_argument('--pairs'); ap.add_argument('--runs'); ap.add_argument('--out')
ap.add_argument('--jobs', type=int, default=3); ap.add_argument('--python', default='/workspace/scratch/hist/venv/bin/python')
ap.add_argument('--solo-reps', type=int, default=3); ap.add_argument('--timeout', type=int, default=1800)
A = ap.parse_args()
G = A.repo
RES_RE = re.compile(r'^(\S+) \(([\w.]+)\)(?:\n.*?)? \.\.\. (ok|FAIL|ERROR|skipped.*|expected failure|unexpected success)\s*$', re.M)

def git(*a, text=True, check=True, **kw):
    r = subprocess.run(['git', '-C', G, *a], capture_output=True, text=text, **kw)
    if check and r.returncode: raise RuntimeError(r.stderr)
    return r.stdout

def labels_for_django(paths):
    out = set()
    for p in paths:
        if not (p.startswith('tests/') and p.endswith('.py')): continue
        parts = p[len('tests/'):-3].split('/')
        if parts[-1] == '__init__' or len(parts) < 2: continue
        if not (parts[-1].startswith('test') or 'tests' in parts[:-1]): continue
        out.add('.'.join(parts))
    return sorted(out)

TESTMOD_RE = re.compile(r'(^|/)test_[^/]*\.py$|(^|/)[^/]*_test\.py$')
def labels_for(paths):
    if A.project == 'django': return labels_for_django(paths)
    return sorted({p for p in paths if p.endswith('.py') and TESTMOD_RE.search(p) and not p.endswith('conftest.py')})

def extract(tree, dst):
    os.makedirs(dst)
    a = subprocess.run(['git', '-C', G, 'archive', tree], capture_output=True, check=True)
    subprocess.run(['tar', '-x', '-C', dst], input=a.stdout, check=True)

def run_tests_django(srcdir, labels, tag):
    t = time.time()
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=srcdir)
    r = subprocess.run([A.python, 'tests/runtests.py', '--parallel', '1', '-v', '2', *labels], cwd=srcdir, capture_output=True, text=True, env=env, timeout=A.timeout)
    res = {}
    for m in RES_RE.finditer(r.stderr + '\n' + r.stdout):
        st = m.group(3); res[m.group(2)] = 'pass' if st in ('ok', 'expected failure') or st.startswith('skipped') else 'fail'
    import_err = 'ImportError' in r.stderr and not res
    return {'tag': tag, 'rc': r.returncode, 'n': len(res), 'failed': sorted(k for k, v in res.items() if v == 'fail'), 'passed': sorted(k for k, v in res.items() if v == 'pass'),
            'secs': round(time.time() - t, 1), 'stderr_tail': r.stderr[-1500:] if (not res or import_err) else ''}

PYRES_RE = re.compile(r'^(PASSED|FAILED|ERROR|XFAIL|XPASS) (\S+?)(?: - .*)?$', re.M)
def run_tests(srcdir, labels, tag):
    if A.project == 'django': return run_tests_django(srcdir, labels, tag)
    t = time.time()
    labels = [l for l in labels if os.path.exists(os.path.join(srcdir, l))]   # modules deleted/absent in this condition: tests count as not passing
    if not labels: return {'tag': tag, 'rc': None, 'n': 0, 'failed': [], 'passed': [], 'secs': 0.0, 'stderr_tail': 'no-test-module-present'}
    pp = os.path.join(srcdir, 'src') if A.project == 'pytest' else srcdir
    if A.project == 'pytest' and not os.path.exists(os.path.join(pp, '_pytest', '_version.py')):   # setuptools_scm file absent from git archive (env deviation)
        open(os.path.join(pp, '_pytest', '_version.py'), 'w').write("version = __version__ = '99.0.0+hist'\nversion_tuple = (99, 0, 0)\n")
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=pp, PYTHONHASHSEED='0')
    try:
        wflags = ['-W', 'ignore::DeprecationWarning', '-W', 'ignore::PendingDeprecationWarning'] if A.project != 'django' else []   # env deviation: one env per project is newer than many bases; deprecations vs filterwarnings=error
        r = subprocess.run([A.python, '-m', 'pytest', '-p', 'no:cacheprovider', '-rA', '--tb=no', '-q', '--continue-on-collection-errors', *wflags, *labels], cwd=srcdir, capture_output=True, text=True, env=env, timeout=A.timeout)
    except subprocess.TimeoutExpired:
        return {'tag': tag, 'error': 'test-timeout'}
    res = {}
    for m in PYRES_RE.finditer(r.stdout):
        st, nid = m.group(1), m.group(2)
        if '::' not in nid: continue   # collection errors (file-level) -> its tests are absent = not passing
        res[nid] = 'pass' if st in ('PASSED', 'XFAIL') else 'fail'
    return {'tag': tag, 'rc': r.returncode, 'n': len(res), 'failed': sorted(k for k, v in res.items() if v == 'fail'), 'passed': sorted(k for k, v in res.items() if v == 'pass'),
            'secs': round(time.time() - t, 1), 'stderr_tail': (r.stdout[-1500:] + r.stderr[-500:]) if not res else ''}

def condition(pair, tree, U, labels, tag, overlay=None):
    td = tempfile.mkdtemp(prefix='histsem-')
    try:
        d = os.path.join(td, 'src'); extract(tree, d)
        if overlay:
            for p, content in overlay.items():
                fp = os.path.join(d, p)
                if content is None:
                    if os.path.exists(fp): os.remove(fp)
                else:
                    os.makedirs(os.path.dirname(fp), exist_ok=True); open(fp, 'wb').write(content)
        pf = os.path.join(td, 'u.patch'); open(pf, 'wb').write(U)
        if U and subprocess.run(['git', 'apply', pf], cwd=d, capture_output=True).returncode:
            return {'tag': tag, 'error': 'union-test-patch-does-not-apply'}
        return run_tests(d, labels, tag)
    finally: shutil.rmtree(td, ignore_errors=True)

def pair_eval(pair, arm_runs):
    pid = pair['pair_id']; wa, wb = pair['writers']
    tp = lambda w: git('diff', '--no-renames', '--binary', w['mb'], w['head'], '--', *w['test_files'], text=False) if w['test_files'] else b''
    UA, UB = tp(wa), tp(wb)
    labels = labels_for(wa['test_files'] + wb['test_files'])
    out = {'pair_id': pid, 'labels': labels, 'arm_runs': {}}
    if not labels: out['status'] = 'not-evaluable:no-test-modules'; return out
    # union test patch must apply on b (A then B)
    td = tempfile.mkdtemp(); d = os.path.join(td, 's'); extract(pair['base'], d)
    ok = True
    for i, u in enumerate([UA, UB]):
        if not u: continue
        f = os.path.join(td, f'{i}.patch'); open(f, 'wb').write(u)
        if subprocess.run(['git', 'apply', f], cwd=d, capture_output=True).returncode: ok = False
    U = subprocess.run(['git', 'diff', '--no-index', '--binary', '--no-renames', '/dev/null', '/dev/null'], capture_output=True).stdout  # placeholder
    if ok:
        subprocess.run(['git', 'init', '-q'], cwd=d); subprocess.run(['git', 'add', '-A'], cwd=d)
        U = UA + UB  # applied sequentially in condition(): combined file is A's patch followed by B's patch
    shutil.rmtree(td, ignore_errors=True)
    if not ok: out['status'] = 'not-evaluable:union-test-patch-conflict'; return out
    # conditions apply UA then UB as one concatenated patch; verify that works per condition (git apply handles multi-file patches; same file in both -> may fail)
    conds = {}
    conds['b'] = condition(pair, pair['base'], U, labels, 'b')
    if conds['b'].get('error'):
        out['status'] = 'not-evaluable:' + conds['b']['error']; out['conditions'] = conds; return out
    for tag, tree in (('A', pair['tree_A']), ('B', pair['tree_B'])):
        conds[tag] = [condition(pair, tree, U, labels, f'{tag}#{k}') for k in range(A.solo_reps)]
    flaky = set()
    for tag in ('A', 'B'):
        sets = [set(c.get('failed', [])) for c in conds[tag]]; allt = set().union(*sets)
        flaky |= {t for t in allt if any(t not in s for s in sets)}
    if any(c.get('error') for c in conds['A'] + conds['B']):
        out['status'] = 'not-evaluable:solo-condition-error'; out['conditions'] = conds; return out
    fa = set(conds['A'][0].get('failed', [])) - flaky; fb = set(conds['B'][0].get('failed', [])) - flaky
    fbase = set(conds['b'].get('failed', [])) - flaky
    passA = set(conds['A'][0].get('passed', [])); passB = set(conds['B'][0].get('passed', []))
    # F2P_X = passes on b+X+U and does NOT pass on b+U (fails, errors, or cannot even be loaded/collected at b)
    pbase = set(conds['b'].get('passed', []))
    f2pA = sorted(passA - pbase - flaky); f2pB = sorted(passB - pbase - flaky)
    out.update(f2p_A=f2pA, f2p_B=f2pB, base_valid=bool(f2pA) and bool(f2pB), flaky=sorted(flaky))
    gold = None
    if pair.get('tree_gold'):
        conds['gold'] = condition(pair, pair['tree_gold'], U, labels, 'gold')
        if conds['gold'].get('error'):
            out['status'] = 'not-evaluable:gold-condition-error'; out['conditions'] = conds; return out
        gold = set(conds['gold'].get('failed', [])) - flaky
        passGold = set(conds['gold'].get('passed', []))
        out['historical_interference'] = sorted(gold - fa - fb)
    out['conditions'] = {k: ([{x: y for x, y in c.items() if x not in ('passed',)} for c in v] if isinstance(v, list) else {x: y for x, y in v.items() if x != 'passed'}) for k, v in conds.items()}
    gold_digests = {}
    if pair.get('tree_gold'):
        for p in pair['base_text']:
            b = subprocess.run(['git', '-C', G, 'cat-file', '-p', f"{pair['tree_gold']}:{p}"], capture_output=True)
            gold_digests[p] = 'sha256:' + hashlib.sha256(b.stdout).hexdigest() if b.returncode == 0 else 'absent'
    cache = {}
    for rid, (res, finals_dir) in arm_runs.items():
        s = res.get('summary') or {}
        if s.get('completed') != s.get('n_intents') or s.get('run_failed'):
            out['arm_runs'][rid] = {'status': 'not-evaluable:not-all-intents-completed'}; continue
        fd = {p: (dg if res['final_exists'].get(p) else 'absent') for p, dg in res['final_digests'].items()}
        key = json.dumps(fd, sort_keys=True)
        if gold is not None and fd == gold_digests:
            out['arm_runs'][rid] = {'status': 'evaluated', 'same_bytes_as_gold': True, 'arm_regression': [], 'gold_relative_regression': []}; continue
        if key not in cache:
            overlay = {p: (None if dg == 'absent' else open(os.path.join(finals_dir, dg[7:]), 'rb').read()) for p, dg in fd.items()}
            c = condition(pair, pair['base'], U, labels, rid, overlay=overlay)
            cache[key] = c
        c = cache[key]
        if c.get('error'): out['arm_runs'][rid] = {'status': 'not-evaluable:' + c['error']}; continue
        fx = set(c.get('failed', [])) - flaky
        reg = sorted(fx - fa - fb - (gold or set())) if gold is not None else None
        out['arm_runs'][rid] = {'status': 'evaluated', 'same_bytes_as_gold': False, 'arm_regression': reg,
                                'gold_relative_regression': sorted(fx - gold) if gold is not None else None, 'n_tests': c.get('n'), 'secs': c.get('secs')}
    out['status'] = 'evaluated' if out['base_valid'] else 'evaluated-base-invalid (semantic endpoint excluded per prereg)'
    return out

pairs = {json.loads(l)['pair_id']: json.loads(l) for l in open(A.pairs)}
runs = {}
for d in sorted(os.listdir(os.path.join(A.runs, 'runs'))):
    r = json.load(open(os.path.join(A.runs, 'runs', d, 'result.json')))
    if r.get('plant') or r.get('harness_error'): continue
    runs.setdefault(r['pair_id'], {})[d] = (r, os.path.join(A.runs, 'finals'))
results = {}
with cf.ThreadPoolExecutor(A.jobs) as ex:
    futs = {ex.submit(pair_eval, pairs[pid], runs.get(pid, {})): pid for pid in pairs}
    for f in cf.as_completed(futs):
        pid = futs[f]
        try: results[pid] = f.result()
        except Exception as e: results[pid] = {'pair_id': pid, 'status': f'harness-error:{e}'}
        print(pid, results[pid].get('status'), flush=True)
json.dump({'method': 'STALE union-test-set, new failures only', 'python': A.python, 'results': results}, open(A.out, 'w'), indent=1, sort_keys=True)
