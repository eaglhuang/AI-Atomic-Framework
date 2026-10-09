#!/usr/bin/env python3
"""Summarise a HIST trial batch: per-arm table (wording rules: completed/total intents, failed/total runs,
lost effects, blocked intents with hash-drift listed separately), planted-fault detection, semantic endpoint.
usage: summarize.py BATCH_DIR LABEL > SUMMARY.md ; also writes BATCH_DIR/summary.json"""
import json, os, sys, glob, collections
D, LABEL = sys.argv[1], sys.argv[2]
R = [json.load(open(f)) for f in sorted(glob.glob(f'{D}/runs/*/result.json'))]
arms = ['steward', 'file_lock', 'occ', 'git_three_way', 'bare_composer']
def cat(reason):
    r = reason or ''
    if r.startswith('file-hash-drift: Target file does not exist'): return 'atm-new-file-unsupported (file-hash-drift: target does not exist)'
    if r.startswith('file-hash-drift'): return 'file-hash-drift'
    if r.startswith('compose-context-mismatch'): return 'compose-context-mismatch (re-compose)'
    if r.startswith('harness-relocate') or r.startswith('occ-relocate'): return 'relocate-context-not-found'
    return r.split(':')[0][:60]
out = {'label': LABEL, 'arms': {}, 'plants': [], 'harness_errors': [r for r in R if r.get('harness_error')]}
rows = []
for a in arms:
    rs = [r for r in R if r.get('arm') == a and not r.get('plant') and not r.get('harness_error')]
    if not rs: continue
    s = lambda k: sum(r['summary'][k] for r in rs)
    blk = collections.Counter()
    for r in rs:
        for line in open(os.path.join(D, 'runs', f"{r['pair_id'].replace(':', '_')}__{a}__s{r['seed_k']}", 'oracle_rows.jsonl')):
            x = json.loads(line)
            if x['terminal_outcome'] != 'commit': blk[cat(x['blocked_reason'])] += 1
    st = collections.Counter(r['stratum'] for r in rs)
    d = {'runs': len(rs), 'failed_runs': sum(r['summary']['run_failed'] for r in rs), 'intents': s('n_intents'), 'completed': s('completed'),
         'lost_effects': s('lost_effects'), 'blocked': s('blocked'), 'misplaced': s('misplaced'), 'duplicate': s('duplicate'), 'blocked_leak': s('blocked_leak'),
         'unresolved': s('unresolved'), 'corrupted_files': s('corrupted_files'), 'structure_violations': s('structure_violations'), 'extra_files': s('extra_files'),
         'identity_ok_all': all(r['summary']['identity_ok'] for r in rs), 'blocked_by_reason': dict(blk), 'by_stratum_runs': dict(st),
         'timed_out': sum(bool(r.get('timed_out')) for r in rs)}
    out['arms'][a] = d
for r in R:
    if not r.get('plant') or r.get('harness_error'): continue
    s = r['summary']; p = r['plant']
    exp = {'planted_raw_overwrite': s['lost_effects'] > 0, 'plant_revert_hunk': s['lost_effects'] > 0 or not any(x.get('changed', True) for x in r['plants']),
           'plant_flip_frame_byte': s['corrupted_files'] > 0, 'plant_torn_tail': s['corrupted_files'] > 0, 'plant_foreign_file': s['extra_files'] > 0 and s['run_failed']}[p]
    out['plants'].append({'pair_id': r['pair_id'], 'plant': p, 'lost': s['lost_effects'], 'corrupted': s['corrupted_files'], 'extra': s['extra_files'],
                          'foreign_writes': s['foreign_writes'], 'run_failed': s['run_failed'], 'detected': bool(exp), 'plant_log': r['plants']})
sem = None
if os.path.exists(f'{D}/semantic.json'):
    sem = json.load(open(f'{D}/semantic.json'))['results']
    agg = collections.defaultdict(lambda: {'evaluated_runs': 0, 'not_evaluable_runs': 0, 'arm_regression_tests': 0, 'gold_relative_regression_tests': 0, 'same_bytes_as_gold': 0})
    for pid, res in sem.items():
        for rid, x in (res.get('arm_runs') or {}).items():
            a = rid.split('__')[1]; g = agg[a]
            if x['status'] != 'evaluated' or not res.get('base_valid'): g['not_evaluable_runs'] += 1; continue
            g['evaluated_runs'] += 1; g['same_bytes_as_gold'] += x.get('same_bytes_as_gold', False)
            g['arm_regression_tests'] += len(x.get('arm_regression') or []); g['gold_relative_regression_tests'] += len(x.get('gold_relative_regression') or [])
    out['semantic'] = {'pairs': {pid: {k: v for k, v in res.items() if k in ('status', 'base_valid', 'labels', 'f2p_A', 'f2p_B', 'flaky', 'historical_interference')} for pid, res in sem.items()}, 'by_arm': dict(agg)}
json.dump(out, open(f'{D}/summary.json', 'w'), indent=1, sort_keys=True)
P = print
P(f'# {LABEL} — 試跑 (trial run), NOT formal results\n')
P('Author-executed, not independently reproduced. GitHub CI only checks record consistency (SHA256SUMS/verify), it does not rerun experiments.\n')
P('| arm | completed/total intents | failed/total runs | lost effects | blocked intents | corrupted files | structure violations | extra files | identity |')
P('|---|---|---|---|---|---|---|---|---|')
for a, d in out['arms'].items():
    P(f"| {a} | {d['completed']}/{d['intents']} | {d['failed_runs']}/{d['runs']} | {d['lost_effects']} | {d['blocked']} | {d['corrupted_files']} | {d['structure_violations']} | {d['extra_files']} | {'ok' if d['identity_ok_all'] else 'BROKEN'} |")
P('\nBlocked intents by final reason (hash-drift listed separately):\n')
for a, d in out['arms'].items():
    P(f"- {a}: " + (', '.join(f'{k} = {v}' for k, v in sorted(d['blocked_by_reason'].items())) or 'none'))
P('\nPlanted faults (oracle validation; injected by the harness, not arm behaviour):\n')
P('| pair | plant | lost | corrupted | extra files | run failed | detected |'); P('|---|---|---|---|---|---|---|')
for x in out['plants']: P(f"| {x['pair_id']} | {x['plant']} | {x['lost']} | {x['corrupted']} | {x['extra']} | {x['run_failed']} | {'yes' if x['detected'] else 'NO'} |")
if out['harness_errors']: P(f"\nHarness errors: {len(out['harness_errors'])}")
if sem:
    P('\nSemantic endpoint (STALE method: same union test set in every condition; only NEW failures after merging):\n')
    P('| pair | status | F2P A | F2P B | flaky | historical interference (gold fails, solos pass) |'); P('|---|---|---|---|---|---|')
    for pid, x in sorted(out['semantic']['pairs'].items()):
        P(f"| {pid} | {x.get('status')} | {len(x.get('f2p_A') or [])} | {len(x.get('f2p_B') or [])} | {len(x.get('flaky') or [])} | {len(x.get('historical_interference') or [])} |")
    P('\n| arm | evaluated runs | not evaluable | same bytes as gold | arm-attributed new failures | gold-relative new failures |'); P('|---|---|---|---|---|---|')
    for a in arms:
        g = out['semantic']['by_arm'].get(a)
        if g: P(f"| {a} | {g['evaluated_runs']} | {g['not_evaluable_runs']} | {g['same_bytes_as_gold']} | {g['arm_regression_tests']} | {g['gold_relative_regression_tests']} |")
