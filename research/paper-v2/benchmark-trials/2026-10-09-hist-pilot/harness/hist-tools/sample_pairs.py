#!/usr/bin/env python3
"""HIST-PAIRS step 3: deterministic sampling (SELECTION_RULES.md §4). smoke first, then pilot from the rest.
usage: sample_pairs.py candidates_dir out_dir"""
import json, sys
import numpy as np
src, out = sys.argv[1], sys.argv[2]
pairs = sorted((json.loads(l) for l in open(f'{src}/pairs_eligible.jsonl')), key=lambda p: (p['project'], p['pair_id']))
used = {}
def draw(seed, quota, exclude):
    rng = np.random.Generator(np.random.PCG64(seed))
    chosen = []
    for st in ['O1', 'O2', 'O3']:
        pool = [p for p in pairs if p['stratum'] == st and p['pair_id'] not in exclude]
        order = rng.permutation(len(pool)) if pool else []
        k = 0
        for i in order:
            if k >= quota[st]: break
            p = pool[int(i)]
            if any(used.get(w['pr'], 0) >= 2 for w in p['writers']): continue
            for w in p['writers']: used[w['pr']] = used.get(w['pr'], 0) + 1
            chosen.append(p['pair_id']); k += 1
        quota[st + '_got'] = k
    return chosen, quota
smoke, qs = draw(20261009, {'O1': 1, 'O2': 1, 'O3': 2}, set())
pilot, qp = draw(20261008, {'O1': 10, 'O2': 10, 'O3': 10}, set(smoke))
# shortfall backfill O1 -> O2 -> O3 order (prereg §4.1): fill remaining pilot slots from other strata
short = 30 - len(pilot)
backfill = []
if short > 0:
    rng = np.random.Generator(np.random.PCG64(20261008 + 1))
    for st in ['O1', 'O2', 'O3']:
        pool = [p for p in pairs if p['stratum'] == st and p['pair_id'] not in set(smoke) | set(pilot)]
        for i in (rng.permutation(len(pool)) if pool else []):
            if short <= 0: break
            p = pool[int(i)]
            if any(used.get(w['pr'], 0) >= 2 for w in p['writers']): continue
            for w in p['writers']: used[w['pr']] = used.get(w['pr'], 0) + 1
            pilot.append(p['pair_id']); backfill.append(p['pair_id']); short -= 1
json.dump({'smoke': smoke, 'smoke_quota': qs, 'pilot': pilot, 'pilot_quota': qp, 'pilot_backfill': backfill,
           'n_candidates': len(pairs), 'by_stratum': {s: sum(p['stratum'] == s for p in pairs) for s in ['O1', 'O2', 'O3']}},
          open(f'{out}/sample.json', 'w'), indent=1)
for name, ids in (('smoke', smoke), ('pilot', pilot)):
    S = set(ids)
    with open(f'{out}/pairs_{name}.jsonl', 'w') as f:
        for p in pairs:
            if p['pair_id'] in S: f.write(json.dumps(p, sort_keys=True) + '\n')
print(json.dumps({'smoke': smoke, 'pilot_n': len(pilot), 'qp': qp, 'backfill': len(backfill)}, indent=0))
