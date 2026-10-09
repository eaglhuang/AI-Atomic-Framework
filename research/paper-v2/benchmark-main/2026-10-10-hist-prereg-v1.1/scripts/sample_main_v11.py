#!/usr/bin/env python3
"""HIST-PAIRS prereg v1.1 §4 main-sample draw (FROZEN with prereg v1.1 BEFORE the draw, 2026-10-10).
Per project (django, sympy, xarray, pytest, sphinx, fastapi), independently:
  pool = v1.0 candidates (mining generation, writer_version=final) U v1.1-P candidates (build_pairs_v11p.py),
         minus every smoke/pilot pair_id (trial sample.json); sorted by pair_id.
  main: rng = numpy Generator(PCG64(20261008)); strata in order O1, O2, O3 with quotas 17/17/16; within a stratum visit
        rng.permutation(len(pool_stratum)); take a pair unless one of its PRs is already in 2 taken pairs (cap 2 per PR).
        shortfall: rng2 = PCG64(20261009); strata O1 -> O2 -> O3 over the remaining pool, same cap, until 50.
  O0 control: all pairs of eligible PRs with overlapping [created_at, merged_at] and NO common source file, sorted by pair_id;
        rng3 = PCG64(20261008); visit rng3.permutation; b = merge-base(mb_A, mb_B); keep if both v1.0 code patches
        `git apply --check` onto b (else recorded 'o0-drift') and the PR cap (shared with the main sample) holds; 5 per project.
  confirmation (TRIAL, not formal; drawn AFTER main and O0 from the residual pool only, so it cannot change the main
        sample): rng4 = PCG64(20261010) over all projects' residual pool sorted by pair_id: first 2 O1 pairs with
        writer_version pre-rebase and o1_kind divergent, then 3 more pairs of distinct projects not yet used (any stratum).
Outputs: sample_main.json, pairs_main.jsonl, pairs_o0.jsonl, pairs_confirm.jsonl (all annotated base_exists),
         run_plan.jsonl (seed table for every planned formal run).
usage: sample_main_v11.py --mining OUT_MINING --v11 OUT_V11 --repos REPOS_DIR --trial trial_sample.json --dest DIR"""
import argparse, json, os, re, subprocess, tempfile, hashlib, collections
from datetime import datetime
import numpy as np
ap = argparse.ArgumentParser()
for a in ['mining', 'v11', 'repos', 'trial', 'dest']: ap.add_argument('--' + a, required=True)
A = ap.parse_args(); os.makedirs(A.dest, exist_ok=True)
PROJECTS = ['django', 'sympy', 'xarray', 'pytest', 'sphinx', 'fastapi']
QUOTA = {'O1': 17, 'O2': 17, 'O3': 16}; N_MAIN, N_O0, SEEDS = 50, 5, [0, 1, 2, 3, 4]
ARMS = ['steward', 'file_lock', 'occ', 'git_three_way', 'bare_composer']
trial = json.load(open(A.trial)); EXCL = set(trial['smoke']) | set(trial['pilot'])
G = None
def git(*args, env=None, check=True, text=True):
    r = subprocess.run(['git', '-C', G, *args], capture_output=True, text=text, env=env)
    if check and r.returncode != 0: raise RuntimeError(f"git {' '.join(args)}: {r.stderr[:300]}")
    return r
def blob_text(rev, path):
    r = git('cat-file', '-p', f'{rev}:{path}', check=False, text=False); return r.stdout if r.returncode == 0 else None
def tmp_index_apply(base, patches):
    with tempfile.TemporaryDirectory() as td:
        env = dict(os.environ, GIT_INDEX_FILE=os.path.join(td, 'idx')); git('read-tree', base, env=env)
        for i, pt in enumerate(patches):
            pf = os.path.join(td, f'p{i}.patch'); open(pf, 'wb').write(pt)
            if subprocess.run(['git', '-C', G, 'apply', '--cached', '--check', pf], env=env, capture_output=True).returncode != 0: return None
            subprocess.run(['git', '-C', G, 'apply', '--cached', pf], env=env, check=True, capture_output=True)
        return git('write-tree', env=env).stdout.strip()
HUNK_RE = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')
def parse_hunks(d, path, bl, nl):   # verbatim v1.0
    out = []
    for l in d.splitlines():
        m = HUNK_RE.match(l)
        if not m: continue
        os_, ol, ns_, nlen = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1), int(m.group(3)), int(m.group(4) if m.group(4) is not None else 1)
        s = os_ if ol == 0 else os_ - 1; ns0 = ns_ if nlen == 0 else ns_ - 1
        pre, post = bl[s:s + ol], nl[ns0:ns0 + nlen]
        kind = 'insert' if ol == 0 else ('delete' if nlen == 0 else 'replace')
        out.append({'path': path, 'start': s, 'end': s + ol, 'kind': kind, 'pre': pre, 'post': post,
                    'ctx_before': bl[max(0, s - 3):s], 'ctx_after': bl[s + ol:s + ol + 3]})
    return out
def hunks_between(b, tree, path):
    base = blob_text(b, path); new = blob_text(tree, path)
    bl = (base or b'').decode('utf-8').splitlines(keepends=True); nl = (new or b'').decode('utf-8').splitlines(keepends=True)
    d = git('diff', '-U0', '--no-renames', '--diff-algorithm=histogram', b, tree, '--', path).stdout
    return parse_hunks(d, path, bl, nl), (base or b'').decode('utf-8')
def dist(h1, h2):
    a0, a1, b0, b1 = h1['start'], h1['end'], h2['start'], h2['end']
    if a0 < b1 and b0 < a1: return 0
    if a0 == b0: return 0
    return max(0, max(b0 - a1, a0 - b1))
def o1_kind(p):
    HA, HB, common = p['writers'][0]['hunks'], p['writers'][1]['hunks'], set(p['common_files'])
    ident, any0 = True, False
    for x in HA:
        for y in HB:
            if x['path'] != y['path'] or x['path'] not in common: continue
            if dist(x, y) == 0:
                any0 = True
                if not (x['start'] == y['start'] and x['end'] == y['end'] and x['post'] == y['post']): ident = False
    return ('identical' if ident else 'divergent') if any0 else None
def iso(t): return datetime.fromisoformat(t.replace('Z', '+00:00'))
def annotate(p):
    p['base_exists'] = {path: git('cat-file', '-e', f"{p['base']}:{path}", check=False).returncode == 0 for path in p['base_text']}
    return p
def seed_for(pid, k): return int.from_bytes(hashlib.sha256(f'hist-v1|{pid}|{k}'.encode()).digest()[:4], 'big')

out = {'frozen_at_rule': 'prereg v1.1', 'projects': {}}; main_rows, o0_rows, residual = [], [], []
for proj in PROJECTS:
    G = f'{A.repos}/{proj}.git'
    meta = []   # (pair_id, stratum, prA, prB, source, o1_kind_or_None)
    for c in map(json.loads, open(f'{A.mining}/{proj}/candidates.jsonl')):
        if c['reason'] == 'candidate': meta.append({'pair_id': c['pair_id'], 'stratum': c['stratum'], 'prA': c['prA'], 'prB': c['prB'], 'rule': 'v1.0'})
    for c in map(json.loads, open(f'{A.v11}/{proj}/v11p_rows.jsonl')):
        if c['p_reason'] == 'p-candidate': meta.append({'pair_id': c['pair_id'], 'stratum': c['stratum'], 'prA': c['prA'], 'prB': c['prB'], 'rule': 'v1.1-P', 'o1_kind': c.get('o1_kind')})
    ids = [m['pair_id'] for m in meta]; assert len(ids) == len(set(ids)), 'pair_id collision v1.0 vs P'
    pool_all = sorted([m for m in meta if m['pair_id'] not in EXCL], key=lambda m: m['pair_id'])
    used = collections.Counter(); chosen = []; got = {}
    def take(c):
        if used[c['prA']] >= 2 or used[c['prB']] >= 2: return False
        used[c['prA']] += 1; used[c['prB']] += 1; chosen.append(c['pair_id']); return True
    rng = np.random.Generator(np.random.PCG64(20261008))
    for st in ['O1', 'O2', 'O3']:
        pool = [c for c in pool_all if c['stratum'] == st]; k = 0
        for i in (rng.permutation(len(pool)) if pool else []):
            if k >= QUOTA[st]: break
            if take(pool[int(i)]): k += 1
        got[st] = k
    short = N_MAIN - len(chosen); bf = collections.Counter(); rng2 = np.random.Generator(np.random.PCG64(20261009))
    for st in ['O1', 'O2', 'O3']:
        cs = set(chosen); pool = [c for c in pool_all if c['stratum'] == st and c['pair_id'] not in cs]
        for i in (rng2.permutation(len(pool)) if pool else []):
            if short <= 0: break
            if take(pool[int(i)]): short -= 1; bf[st] += 1
    # O0
    elig = sorted([r for r in map(json.loads, open(f'{A.mining}/{proj}/pr_eligibility.jsonl')) if r['reason'] == 'eligible'], key=lambda r: r['number'])
    o0 = []
    for i_, ra in enumerate(elig):
        for rb in elig[i_ + 1:]:
            if not (iso(ra['created_at']) <= iso(rb['merged_at']) and iso(rb['created_at']) <= iso(ra['merged_at'])): continue
            if set(ra['src_files']) & set(rb['src_files']): continue
            o0.append((f"{proj}:{ra['number']}_{rb['number']}", ra, rb))
    o0.sort(key=lambda x: x[0]); rng3 = np.random.Generator(np.random.PCG64(20261008)); o0_taken, o0_log = [], collections.Counter()
    for i in (rng3.permutation(len(o0)) if o0 else []):
        if len(o0_taken) >= N_O0: break
        pid, ra, rb = o0[int(i)]
        if used[ra['number']] >= 2 or used[rb['number']] >= 2: o0_log['o0-pr-cap'] += 1; continue
        b = git('merge-base', ra['mb'], rb['mb'], check=False).stdout.strip()
        if not b: o0_log['o0-no-shared-base'] += 1; continue
        pa = git('diff', '--no-renames', '--diff-algorithm=histogram', '--binary', ra['mb'], ra['head_sha'], '--', *ra['src_files'], text=False).stdout
        pb = git('diff', '--no-renames', '--diff-algorithm=histogram', '--binary', rb['mb'], rb['head_sha'], '--', *rb['src_files'], text=False).stdout
        try:
            for pth in set(ra['src_files']) | set(rb['src_files']):
                bt = blob_text(b, pth)
                if bt is not None: bt.decode('utf-8')
        except UnicodeDecodeError: o0_log['o0-base-not-utf8'] += 1; continue
        ta, tb = tmp_index_apply(b, [pa]), tmp_index_apply(b, [pb])
        if ta is None or tb is None: o0_log['o0-drift'] += 1; continue
        HA, HB, base_text = [], [], {}
        for pth in sorted(ra['src_files']): hs, bt = hunks_between(b, ta, pth); HA += hs; base_text[pth] = bt
        for pth in sorted(rb['src_files']): hs, bt = hunks_between(b, tb, pth); HB += hs; base_text[pth] = bt
        for k, h in enumerate(HA): h['logical_id'] = f"log:{pid}:{ra['number']}:{h['path']}:h{k}"
        for k, h in enumerate(HB): h['logical_id'] = f"log:{pid}:{rb['number']}:{h['path']}:h{k}"
        gold = tmp_index_apply(b, [pa, pb])
        used[ra['number']] += 1; used[rb['number']] += 1; o0_log['o0-taken'] += 1
        tp = lambda r: git('diff', '--no-renames', '--diff-algorithm=histogram', '--binary', r['mb'], r['head_sha'], '--', *r['test_files'], text=False).stdout if r['test_files'] else b''
        o0_taken.append(annotate({'pair_id': pid, 'prA': ra['number'], 'prB': rb['number'], 'project': proj, 'reason': 'candidate', 'rule': 'v1.0-O0', 'stratum': 'O0',
            'base': b, 'common_files': [], 'min_dist': None, 'files': sorted(set(ra['src_files']) | set(rb['src_files'])), 'base_text': base_text, 'tree_A': ta, 'tree_B': tb,
            'tree_gold': gold, 'gold_apply_clean': gold is not None, 'git_merge_file_clean': True, 'n_hunks_A': len(HA), 'n_hunks_B': len(HB), 'o1_kind': None,
            'semantic_endpoint': 'eligible-if-base-valid',
            'writers': [{'pr': r['number'], 'mb': r['mb'], 'head': r['head_sha'], 'final_head': r['head_sha'], 'landing': r['merge_commit_sha'], 'writer_version': 'final',
                         'hunks': H, 'test_files': r['test_files'], 'code_patch_sha256': hashlib.sha256(pt).hexdigest(), 'test_patch_sha256': hashlib.sha256(tp(r)).hexdigest()}
                        for r, H, pt in ((ra, HA, pa), (rb, HB, pb))]}))
    # full payloads of the chosen main pairs (+ residual meta for the confirmation draw)
    S = set(chosen); byid = {}
    for line in open(f'{A.mining}/{proj}/pairs_eligible.jsonl'):
        # cheap pair_id extraction (rows are json.dumps(sort_keys=True); first "pair_id" key is the pair's own id)
        k0 = line.find('"pair_id": "'); pid = line[k0 + 12: line.find('"', k0 + 12)]
        if pid in S:
            j = json.loads(line); j.update(rule='v1.0', o1_kind=o1_kind(j) if j['stratum'] == 'O1' else None, semantic_endpoint='eligible-if-base-valid')
            for w in j['writers']: w.update(writer_version='final', final_head=w['head'])
            byid[pid] = j
    for line in open(f'{A.v11}/{proj}/v11p_pairs_eligible.jsonl'):
        j = json.loads(line)
        if j['pair_id'] in S: byid[j['pair_id']] = j
        elif j['pair_id'] not in EXCL: residual.append(j)
    assert set(byid) == S, (proj, len(byid), len(S))
    for pid in chosen: main_rows.append(annotate(byid[pid]))
    o0_rows += o0_taken
    st_count = collections.Counter(byid[p]['stratum'] for p in chosen)
    out['projects'][proj] = {'pool_after_trial_exclusion': len(pool_all), 'pool_by_stratum_rule': dict(collections.Counter(f"{c['stratum']}|{c['rule']}" for c in pool_all)),
        'excluded_trial_pairs': sum(1 for m in meta if m['pair_id'] in EXCL), 'quota_phase_got': got, 'backfill': dict(bf), 'drawn': len(chosen),
        'drawn_by_stratum': dict(st_count), 'drawn_by_rule': dict(collections.Counter(byid[p]['rule'] for p in chosen)),
        'drawn_o1_kind': dict(collections.Counter(byid[p]['o1_kind'] for p in chosen if byid[p]['stratum'] == 'O1')),
        'main_ids_in_draw_order': chosen, 'o0_ids': [x['pair_id'] for x in o0_taken], 'o0_log': dict(o0_log), 'o0_universe': len(o0)}
# confirmation (trial): residual = v1.1-P pairs not in the main sample / O0 / trial (the O1-P stratum is the one to exercise)
used_main = {r['pair_id'] for r in main_rows} | {r['pair_id'] for r in o0_rows}
residual = sorted([r for r in residual if r['pair_id'] not in used_main], key=lambda r: r['pair_id'])
rng4 = np.random.Generator(np.random.PCG64(20261010)); conf = []
perm = [residual[int(i)] for i in rng4.permutation(len(residual))] if residual else []
for r in perm:
    if len(conf) >= 2: break
    if r['stratum'] == 'O1' and r['o1_kind'] == 'divergent': conf.append(r)
projs_used = {r['project'] for r in conf}
for r in perm:
    if len(conf) >= 5: break
    if r in conf or r['project'] in projs_used: continue
    conf.append(r); projs_used.add(r['project'])
G = None
conf_rows = []
for r in conf: G = f"{A.repos}/{r['project']}.git"; conf_rows.append(annotate(r))
out['confirmation_trial_ids'] = [r['pair_id'] for r in conf_rows]; out['residual_p_pairs'] = len(residual)
def dump(name, rows):
    with open(f'{A.dest}/{name}', 'w') as f:
        for r in rows: f.write(json.dumps(r, sort_keys=True) + '\n')
dump('pairs_main.jsonl', main_rows); dump('pairs_o0.jsonl', o0_rows); dump('pairs_confirm.jsonl', conf_rows)
with open(f'{A.dest}/run_plan.jsonl', 'w') as f:
    for p in main_rows:
        for k in SEEDS:
            for a in ARMS: f.write(json.dumps({'set': 'main', 'pair_id': p['pair_id'], 'arm': a, 'seed_k': k, 'seed': seed_for(p['pair_id'], k), 'pin': 'current'}) + '\n')
            f.write(json.dumps({'set': 'old_pin', 'pair_id': p['pair_id'], 'arm': 'steward', 'seed_k': k, 'seed': seed_for(p['pair_id'], k), 'pin': 'old-5692474f'}) + '\n')
    for p in o0_rows:
        for k in SEEDS:
            for a in ARMS: f.write(json.dumps({'set': 'o0', 'pair_id': p['pair_id'], 'arm': a, 'seed_k': k, 'seed': seed_for(p['pair_id'], k), 'pin': 'current'}) + '\n')
out['totals'] = {'main_pairs': len(main_rows), 'o0_pairs': len(o0_rows), 'main_by_stratum': dict(collections.Counter(p['stratum'] for p in main_rows)),
                 'main_by_rule': dict(collections.Counter(p['rule'] for p in main_rows)),
                 'main_o1_by_kind_rule': dict(collections.Counter(f"{p['o1_kind']}|{p['rule']}" for p in main_rows if p['stratum'] == 'O1')),
                 'planned_runs': {'main': len(main_rows) * 25, 'old_pin': len(main_rows) * 5, 'o0': len(o0_rows) * 25}}
out['totals']['planned_runs']['total'] = sum(out['totals']['planned_runs'].values())
json.dump(out, open(f'{A.dest}/sample_main.json', 'w'), indent=1, sort_keys=True)
print(json.dumps(out['totals'], indent=1)); print({p: (v['drawn_by_stratum'], v['backfill']) for p, v in out['projects'].items()}); print(out['confirmation_trial_ids'])
