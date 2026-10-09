#!/usr/bin/env python3
"""Before/after (descriptive only): stopped generation 2026-10-10-hist-main (ATM 20effd45) vs rerun (ATM b1fd9d22)
on the overlapping runs (main set, projects present in BEFORE: django, sympy). Same pairs, seeds, harness.
Runs are concurrent and timing-dependent, so differences can come from scheduling as well as from the ATM change.
usage: before_after.py --before-flat runs_flat.jsonl --after-flat runs_flat.jsonl --before-root DIR --after-root DIR --out DIR"""
import argparse, json, os, glob, collections
ap = argparse.ArgumentParser()
for a in ['before-flat', 'after-flat', 'before-root', 'after-root', 'out']: ap.add_argument('--' + a, required=True)
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
ARMS = ['steward', 'file_lock', 'occ', 'git_three_way', 'bare_composer']
def load(f): return {(r['pair_id'], r['arm'], r['seed_k']): r for r in map(json.loads, open(f)) if r['set'] == 'main'}
B, Aa = load(A.before_flat), load(A.after_flat)
keys = sorted(set(B) & set(Aa)); projects = sorted({B[k]['project'] for k in keys})
def digests(root, k):
    pid, arm, s = k; d = os.path.join(root, 'main', pid.split(':')[0], 'runs', f"{pid.replace(':', '_')}__{arm}__s{s}", 'result.json')
    try: return json.load(open(d)).get('final_digests')
    except Exception: return None
F = ['completed', 'lost', 'blocked', 'corrupted', 'failed']
out = {'label': 'author-executed, not independently reproduced; descriptive only', 'overlap_runs': len(keys), 'projects': projects,
       'before_only': len(set(B) - set(Aa)), 'after_only_in_these_projects': len([k for k in Aa if Aa[k]['project'] in projects and k not in B]), 'by_arm': {}, 'changed_runs': []}
for arm in ARMS:
    ks = [k for k in keys if k[1] == arm]
    if not ks: continue
    agg = {w: {f: sum(int(X[k][f]) for k in ks) for f in F + ['n']} for w, X in (('before', B), ('after', Aa))}
    for w in agg: agg[w]['failed_pairs'] = len({k[0] for k in ks if (B if w == 'before' else Aa)[k]['failed']})
    same_counts = sum(all(B[k][f] == Aa[k][f] for f in F) for k in ks)
    same_bytes = sum(1 for k in ks if digests(A.before_root, k) is not None and digests(A.before_root, k) == digests(A.after_root, k))
    out['by_arm'][arm] = {'runs': len(ks), **agg, 'runs_same_outcome_counts': same_counts, 'runs_same_final_bytes': same_bytes}
    for k in ks:
        if any(B[k][f] != Aa[k][f] for f in F):
            out['changed_runs'].append({'pair_id': k[0], 'arm': arm, 'seed_k': k[2], 'stratum': B[k]['stratum'], 'writer_version': B[k]['writer_version'],
                                        'before': {f: B[k][f] for f in F}, 'after': {f: Aa[k][f] for f in F}})
focus = 'sympy:26412_26438'
out['focus_pair'] = {'pair_id': focus, 'runs': [{'arm': k[1], 'seed_k': k[2], 'before': {f: B[k][f] for f in F}, 'after': {f: Aa[k][f] for f in F}} for k in keys if k[0] == focus]}
json.dump(out, open(os.path.join(A.out, 'before_after.json'), 'w'), indent=1, sort_keys=True)
L = ['# Before/after: 20effd45 (stopped generation) vs b1fd9d22 (EOF fix), overlapping Django+SymPy main runs', '',
     'Author-executed, not independently reproduced, descriptive only. Same pairs, seeds and harness. Runs are concurrent, so some changes can come from scheduling rather than the ATM change.', '',
     f"Overlapping runs: {len(keys)} (projects: {', '.join(projects)})", '',
     '| arm | runs | completed before → after | lost before → after | blocked before → after | corrupted before → after | failed runs before → after | failed pairs before → after | runs with same counts | runs with same final bytes |', '|---|---|---|---|---|---|---|---|---|---|']
for arm, g in out['by_arm'].items():
    b, a = g['before'], g['after']
    L.append(f"| {arm} | {g['runs']} | {b['completed']} → {a['completed']} | {b['lost']} → {a['lost']} | {b['blocked']} → {a['blocked']} | {b['corrupted']} → {a['corrupted']} | {b['failed']} → {a['failed']} | {b['failed_pairs']} → {a['failed_pairs']} | {g['runs_same_outcome_counts']} | {g['runs_same_final_bytes']} |")
L += ['', f'Focus pair {focus} (the §5.7 counterexample in the stopped generation):', '', '| arm | seed | before (completed/lost/blocked/corrupted/failed) | after |', '|---|---|---|---|']
for r in out['focus_pair']['runs']:
    fm = lambda d: '/'.join(str(int(d[f])) for f in F)
    L.append(f"| {r['arm']} | {r['seed_k']} | {fm(r['before'])} | {fm(r['after'])} |")
L += ['', f"Runs whose outcome counts changed: {len(out['changed_runs'])} (listed in before_after.json)", '']
open(os.path.join(A.out, 'BEFORE_AFTER.md'), 'w').write('\n'.join(L) + '\n'); print('\n'.join(L))
