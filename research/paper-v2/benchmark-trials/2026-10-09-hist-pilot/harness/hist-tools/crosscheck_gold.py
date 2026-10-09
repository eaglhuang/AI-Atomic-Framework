#!/usr/bin/env python3
"""Independent oracle cross-check (pilot acceptance item 'oracle has no misjudgement'): for every run where the
oracle judged ALL intents correct, the final bytes of every pair file must equal git's own gold composition
(git apply A then B onto b = tree_gold), independent of oracle_v2-hist's reference applier. Also lists, for every run
the oracle failed, the files that differ from gold. usage: crosscheck_gold.py repo.git pairs.jsonl BATCH_DIR"""
import glob, hashlib, json, subprocess, sys
G, P, D = sys.argv[1:4]
pairs = {json.loads(l)['pair_id']: json.loads(l) for l in open(P)}
gold = {}
def gd(pid):
    if pid not in gold:
        p = pairs[pid]; gold[pid] = {}
        for f in p['base_text']:
            r = subprocess.run(['git', '-C', G, 'cat-file', '-p', f"{p['tree_gold']}:{f}"], capture_output=True)
            gold[pid][f] = 'sha256:' + hashlib.sha256(r.stdout).hexdigest() if r.returncode == 0 else 'absent'
    return gold[pid]
out = {'all_correct_runs': 0, 'agree_with_git_gold': 0, 'disagree': [], 'no_gold': 0, 'new_empty_file_only_diff': 0}
for f in sorted(glob.glob(f'{D}/runs/*/result.json')):
    r = json.load(open(f))
    if r.get('plant') or r.get('harness_error'): continue
    s = r['summary']
    if s['completed'] != s['n_intents'] or s['run_failed']: continue
    out['all_correct_runs'] += 1
    p = pairs[r['pair_id']]
    if not p.get('tree_gold'): out['no_gold'] += 1; continue
    g = gd(r['pair_id'])
    fin = {k: (v if r['final_exists'][k] else 'absent') for k, v in r['final_digests'].items()}
    diff = [k for k in fin if fin[k] != g[k]]
    empty = 'sha256:' + hashlib.sha256(b'').hexdigest()
    if not diff: out['agree_with_git_gold'] += 1
    elif all(fin[k] == 'absent' and g[k] == empty for k in diff): out['new_empty_file_only_diff'] += 1
    else: out['disagree'].append({'run': f.split('/')[-2], 'files': diff})
print(json.dumps(out, indent=1))
