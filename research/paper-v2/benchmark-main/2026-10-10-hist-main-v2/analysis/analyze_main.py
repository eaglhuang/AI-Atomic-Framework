#!/usr/bin/env python3
"""HIST main run analysis (prereg v1.1 §6; descriptive only, no tests of significance, no win claims).
usage: analyze_main.py --runs-root MAIN_RUN_DIR --pairs-main pairs_main.jsonl --pairs-o0 pairs_o0.jsonl [--semantic-dir DIR] --out DIR"""
import argparse, json, glob, os, math, collections
import numpy as np
ap = argparse.ArgumentParser()
for a in ['runs-root', 'pairs-main', 'pairs-o0', 'out']: ap.add_argument('--' + a, required=True)
ap.add_argument('--semantic-dir'); A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
ARMS = ['steward', 'file_lock', 'occ', 'git_three_way', 'bare_composer']
CATS = ['harness_relocation', 'atm_hash_drift', 'atm_recompose_mismatch', 'new_file', 'git_merge_conflict', 'git_base_drift', 'other']
def cat(r):
    r = str(r or '')
    if 'relocate-context-not-found' in r: return 'harness_relocation'
    if 'Target file does not exist' in r: return 'new_file'
    if r.startswith('file-hash-drift') or 'base hash is stale' in r: return 'atm_hash_drift'
    if r.startswith('compose-context-mismatch') or 're-compose' in r: return 'atm_recompose_mismatch'
    if r == 'git-merge-conflict': return 'git_merge_conflict'
    if r == 'git-base-drift': return 'git_base_drift'
    return 'other'
meta = {}
for f, s in ((A.pairs_main, 'main'), (A.pairs_o0, 'o0')):
    for l in open(f):
        p = json.loads(l)
        meta[p['pair_id']] = {'project': p['project'], 'stratum': p['stratum'], 'rule': p['rule'], 'o1_kind': p.get('o1_kind'),
                              'writer_version': 'pre-rebase' if any(w['writer_version'] == 'pre-rebase' for w in p['writers']) else 'final'}
runs = []; other_reasons = collections.Counter(); missing = []
for setname, pat in (('main', 'main/*/runs/*'), ('o0', 'o0/runs/*'), ('old_pin', 'oldpin/runs/*')):
    for d in sorted(glob.glob(os.path.join(A.runs_root, pat))):
        if not os.path.exists(d + '/result.json'): missing.append(d); continue
        r = json.load(open(d + '/result.json'))
        if r.get('harness_error'):
            runs.append({'set': setname, 'pair_id': r['pair_id'], 'arm': r['arm'], 'seed_k': r['seed_k'], 'harness_error': True, **meta[r['pair_id']]}); continue
        s = r['summary']; bc = collections.Counter(); br = collections.Counter()
        for l in open(d + '/oracle_rows.jsonl'):
            if not l.strip(): continue
            o = json.loads(l)
            if o['terminal_outcome'] != 'commit':
                reason = o.get('blocked_reason') or o['terminal_outcome'] or 'unresolved'
                c = cat(reason); bc[c] += 1
                if c == 'other': other_reasons[(r['arm'], str(reason)[:80])] += 1
        runs.append({'set': setname, 'pair_id': r['pair_id'], 'arm': r['arm'], 'seed_k': r['seed_k'], 'n': s['n_intents'], 'completed': s['completed'],
                     'lost': s['lost_effects'], 'blocked': s['blocked'], 'misplaced': s.get('misplaced', 0), 'duplicate': s.get('duplicate', 0),
                     'leak': s.get('blocked_leak', 0), 'unresolved': s.get('unresolved', 0), 'corrupted': s['corrupted_files'],
                     'structure': s.get('structure_violations', 0), 'extra': s.get('extra_files', 0), 'foreign': s.get('foreign_writes', 0),
                     'failed': bool(s['run_failed']), 'identity_ok': bool(s['identity_ok']), 'timed_out': bool(r.get('timed_out')),
                     'block_cats': dict(bc), 'wall_ms': r.get('wall_ms'), **meta[r['pair_id']]})
def wilson(k, n, z=1.959963984540054):
    if n == 0: return (None, None)
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))
def cp_upper(n, alpha=0.05):   # two-sided Clopper-Pearson upper bound for 0 events
    return 1 - (alpha / 2) ** (1 / n) if n else None
def boot_ratio(rows, B=10000, seed=20261008):
    by = collections.defaultdict(lambda: [0, 0])
    for r in rows: by[r['pair_id']][0] += r['completed']; by[r['pair_id']][1] += r['n']
    a = np.array(list(by.values()), dtype=float)
    if len(a) == 0: return (None, None)
    rng = np.random.Generator(np.random.PCG64(seed)); idx = rng.integers(0, len(a), size=(B, len(a)))
    num = a[idx, 0].sum(1); den = a[idx, 1].sum(1); q = np.quantile(num / den, [0.025, 0.975])
    return (float(q[0]), float(q[1]))
def agg(rows, boot=True):
    ok = [r for r in rows if not r.get('harness_error')]
    n = sum(r['n'] for r in ok); c = sum(r['completed'] for r in ok); fr = sum(r['failed'] for r in ok); R = len(ok)
    pairs = sorted({r['pair_id'] for r in ok}); fp = len({r['pair_id'] for r in ok if r['failed']})
    bc = collections.Counter()
    for r in ok: bc.update(r['block_cats'])
    out = {'runs': R, 'harness_errors': len(rows) - R, 'intents': n, 'completed': c, 'completed_ratio': c / n if n else None,
           'completed_ci95_pair_bootstrap': boot_ratio(ok) if boot else None, 'completed_ci95_wilson_intent_level': wilson(c, n),
           'failed_runs': fr, 'failed_runs_ci95_wilson': wilson(fr, R), 'pairs': len(pairs), 'failed_pairs': fp,
           'failed_pairs_ci95_wilson': wilson(fp, len(pairs)), 'failed_pairs_cp_upper_if_zero': cp_upper(len(pairs)) if fp == 0 else None,
           'lost_effects': sum(r['lost'] for r in ok), 'blocked': sum(r['blocked'] for r in ok), 'misplaced': sum(r['misplaced'] for r in ok),
           'duplicate': sum(r['duplicate'] for r in ok), 'blocked_leak': sum(r['leak'] for r in ok), 'unresolved': sum(r['unresolved'] for r in ok),
           'corrupted_files': sum(r['corrupted'] for r in ok), 'structure_violations': sum(r['structure'] for r in ok), 'extra_files': sum(r['extra'] for r in ok),
           'foreign_writes': sum(r['foreign'] for r in ok), 'timeouts': sum(r['timed_out'] for r in ok), 'identity_violations': sum(not r['identity_ok'] for r in ok),
           'blocked_by_category': {k: bc.get(k, 0) for k in CATS}}
    out['identity_check'] = (out['completed'] + out['lost_effects'] + out['blocked'] + out['misplaced'] + out['duplicate'] + out['unresolved'] + out['blocked_leak'] == n)
    return out
T = {'label': 'author-executed, not independently reproduced; descriptive only; CI (GitHub Actions) only checks record consistency', 'sets': {}}
for s in ['main', 'o0', 'old_pin']:
    rs = [r for r in runs if r['set'] == s]
    if not rs: continue
    S = {'by_arm': {}, 'by_arm_stratum': {}, 'by_arm_project': {}, 'by_arm_writer_version': {}, 'by_arm_rule': {}, 'by_arm_o1_kind': {}}
    for a in ARMS:
        ra = [r for r in rs if r['arm'] == a]
        if not ra: continue
        S['by_arm'][a] = agg(ra)
        for key, field in (('by_arm_stratum', 'stratum'), ('by_arm_project', 'project'), ('by_arm_writer_version', 'writer_version'), ('by_arm_rule', 'rule')):
            S[key][a] = {v: agg([r for r in ra if r[field] == v]) for v in sorted({r[field] for r in ra})}
        S['by_arm_o1_kind'][a] = {f'{k}|{w}': agg([r for r in ra if r['stratum'] == 'O1' and r['o1_kind'] == k and r['writer_version'] == w])
                                  for k, w in sorted({(r['o1_kind'], r['writer_version']) for r in ra if r['stratum'] == 'O1'})}
    # paired per (pair, seed): steward vs each other arm (completed intents)
    idx = {(r['pair_id'], r['seed_k'], r['arm']): r for r in rs if not r.get('harness_error')}
    pc = {}
    for a in ARMS[1:]:
        h = s_ = l = 0; diff = 0
        for (pid, k, arm), r in idx.items():
            if arm != 'steward' or (pid, k, a) not in idx: continue
            o = idx[(pid, k, a)]; d = r['completed'] - o['completed']; diff += d
            h += d > 0; s_ += d == 0; l += d < 0
        pc[f'steward_vs_{a}'] = {'steward_higher': h, 'same': s_, 'steward_lower': l, 'sum_completed_diff': diff}
    S['paired_completed_counts'] = pc
    T['sets'][s] = S
# counterexamples (§5.7): steward at the current pin
T['counterexamples_steward_current_pin'] = [{k: r[k] for k in ('set', 'pair_id', 'seed_k', 'lost', 'corrupted', 'structure', 'extra', 'failed')}
                                            for r in runs if r['arm'] == 'steward' and r['set'] in ('main', 'o0') and not r.get('harness_error') and (r['lost'] or r['corrupted'])]
T['failed_steward_runs_any_reason'] = [{k: r[k] for k in ('set', 'pair_id', 'seed_k', 'lost', 'corrupted', 'structure', 'extra', 'misplaced', 'leak', 'failed')}
                                       for r in runs if r['arm'] == 'steward' and not r.get('harness_error') and r['failed']]
T['baseline_loss_runs'] = [{k: r[k] for k in ('set', 'arm', 'pair_id', 'seed_k', 'stratum', 'lost', 'misplaced', 'corrupted')}
                           for r in runs if r['arm'] != 'steward' and not r.get('harness_error') and (r['lost'] or r['corrupted'] or r['misplaced'])]
T['other_block_reasons'] = [{'arm': a, 'reason': rr, 'n': n} for (a, rr), n in sorted(other_reasons.items())]
T['missing_result_dirs'] = missing
T['n_runs'] = {s: sum(r['set'] == s for r in runs) for s in ['main', 'o0', 'old_pin']}
# semantic endpoint
if A.semantic_dir and os.path.isdir(A.semantic_dir):
    sem = {}
    for f in glob.glob(os.path.join(A.semantic_dir, '*.json')):
        sem.update(json.load(open(f))['results'])
    stat = collections.Counter(v.get('status', '?').split(' ')[0] for v in sem.values())
    arm_rows = collections.defaultdict(lambda: collections.Counter()); hist_int = 0
    for pid, v in sem.items():
        if v.get('historical_interference'): hist_int += 1
        if not v.get('base_valid'): continue
        for rid, ar in (v.get('arm_runs') or {}).items():
            arm = rid.split('__')[1]; c = arm_rows[arm]
            if ar['status'] != 'evaluated': c['not_evaluable'] += 1; continue
            c['evaluated'] += 1; c['same_bytes_as_gold'] += int(bool(ar.get('same_bytes_as_gold')))
            c['runs_with_arm_regression'] += int(bool(ar.get('arm_regression'))); c['arm_regression_tests'] += len(ar.get('arm_regression') or [])
            c['runs_with_gold_relative_regression'] += int(bool(ar.get('gold_relative_regression')))
    T['semantic'] = {'scope': 'final/final pairs only (main rule v1.0 + O0); every pair with a pre-rebase writer is not evaluable by prereg v1.1',
                     'pairs_attempted': len(sem), 'pair_status': dict(stat), 'base_valid_pairs': sum(bool(v.get('base_valid')) for v in sem.values()),
                     'pairs_with_historical_interference_any_status': hist_int,
                     'base_valid_pairs_with_historical_interference': sum(bool(v.get('historical_interference')) for v in sem.values() if v.get('base_valid')),
                     'by_arm_base_valid_pairs': {a: dict(c) for a, c in arm_rows.items()}}
json.dump(T, open(os.path.join(A.out, 'tables.json'), 'w'), indent=1, sort_keys=True)
with open(os.path.join(A.out, 'runs_flat.jsonl'), 'w') as f:
    for r in runs: f.write(json.dumps(r, sort_keys=True) + '\n')
# markdown
def pct(x): return '—' if x is None else f'{100*x:.1f}%'
def ci(t): return '—' if not t or t[0] is None else f'{100*t[0]:.1f}–{100*t[1]:.1f}%'
L = ['# HIST main run — tables (author-executed, not independently reproduced; descriptive only)', '']
for s, S in T['sets'].items():
    L += [f'## set: {s}', '', '| arm | completed/total intents (pair-bootstrap 95% CI) | failed/total runs (Wilson 95% CI) | failed pairs/pairs (Wilson; CP upper if 0) | lost effects | blocked intents | corrupted files | structure viol. | extra files |', '|---|---|---|---|---|---|---|---|---|']
    for a, g in S['by_arm'].items():
        fpu = f"; CP≤{pct(g['failed_pairs_cp_upper_if_zero'])}" if g['failed_pairs_cp_upper_if_zero'] else ''
        L.append(f"| {a} | {g['completed']}/{g['intents']} = {pct(g['completed_ratio'])} ({ci(g['completed_ci95_pair_bootstrap'])}) | {g['failed_runs']}/{g['runs']} ({ci(g['failed_runs_ci95_wilson'])}) | {g['failed_pairs']}/{g['pairs']} ({ci(g['failed_pairs_ci95_wilson'])}{fpu}) | {g['lost_effects']} | {g['blocked']} | {g['corrupted_files']} | {g['structure_violations']} | {g['extra_files']} |")
    L += ['', 'Blocked intents by final reason (harness relocation = fail-closed stop in the shared harness BEFORE any ATM call; ATM categories come from ATM itself):', '',
          '| arm | ' + ' | '.join(CATS) + ' |', '|---|' + '---|' * len(CATS)]
    for a, g in S['by_arm'].items(): L.append(f'| {a} | ' + ' | '.join(str(g['blocked_by_category'][k]) for k in CATS) + ' |')
    L += ['', 'Per stratum (completed/total; failed runs; lost; blocked: relocation / ATM hash drift / ATM recompose / new file / git / other):', '', '| arm | stratum | completed/total | failed runs | lost | corrupted | reloc | hash-drift | recompose | new-file | git | other |', '|---|---|---|---|---|---|---|---|---|---|---|---|']
    for a in S['by_arm_stratum']:
        for st, g in S['by_arm_stratum'][a].items():
            b = g['blocked_by_category']
            L.append(f"| {a} | {st} | {g['completed']}/{g['intents']} ({pct(g['completed_ratio'])}) | {g['failed_runs']}/{g['runs']} | {g['lost_effects']} | {g['corrupted_files']} | {b['harness_relocation']} | {b['atm_hash_drift']} | {b['atm_recompose_mismatch']} | {b['new_file']} | {b['git_merge_conflict']+b['git_base_drift']} | {b['other']} |")
    L += ['', 'Per project:', '', '| arm | project | completed/total | failed runs | lost | corrupted | blocked |', '|---|---|---|---|---|---|---|']
    for a in S['by_arm_project']:
        for pj, g in S['by_arm_project'][a].items():
            L.append(f"| {a} | {pj} | {g['completed']}/{g['intents']} ({pct(g['completed_ratio'])}) | {g['failed_runs']}/{g['runs']} | {g['lost_effects']} | {g['corrupted_files']} | {g['blocked']} |")
    L += ['', 'Per writer version (pre-rebase = option P pairs):', '', '| arm | writer_version | completed/total | failed runs | lost | corrupted | reloc blocks |', '|---|---|---|---|---|---|---|']
    for a in S['by_arm_writer_version']:
        for wv, g in S['by_arm_writer_version'][a].items():
            L.append(f"| {a} | {wv} | {g['completed']}/{g['intents']} ({pct(g['completed_ratio'])}) | {g['failed_runs']}/{g['runs']} | {g['lost_effects']} | {g['corrupted_files']} | {g['blocked_by_category']['harness_relocation']} |")
    if S.get('paired_completed_counts'):
        L += ['', 'Paired per (pair, seed), completed intents (descriptive, no test):', '', '| comparison | steward higher | same | steward lower | sum of differences |', '|---|---|---|---|---|']
        for k, v in S['paired_completed_counts'].items(): L.append(f"| {k} | {v['steward_higher']} | {v['same']} | {v['steward_lower']} | {v['sum_completed_diff']} |")
    L.append('')
L += ['## Counterexamples (steward at current pin: lost effect or corrupted file)', '', f"{len(T['counterexamples_steward_current_pin'])}: " + json.dumps(T['counterexamples_steward_current_pin']), '',
      f"Failed steward runs (any reason, any pin): {len(T['failed_steward_runs_any_reason'])}", '', f"Baseline runs with loss/misplacement/corruption: {len(T['baseline_loss_runs'])}", '']
if 'semantic' in T: L += ['## Semantic endpoint (STALE; final/final pairs only)', '', '```', json.dumps(T['semantic'], indent=1), '```']
open(os.path.join(A.out, 'TABLES.md'), 'w').write('\n'.join(L) + '\n')
print('\n'.join(L[:60]))
