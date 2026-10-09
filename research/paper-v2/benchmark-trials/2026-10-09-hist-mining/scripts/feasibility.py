#!/usr/bin/env python3
"""FEASIBILITY DRY-RUN ONLY (not the main-sample draw; the main sample is drawn only after prereg v1.0/v1.1 is
sealed and the author signs off). Per project: can 50 pairs (O1/O2/O3 ~1/3 each, shortfall backfilled O1->O2->O3)
be drawn under 'max 2 pairs per PR', excluding smoke/pilot pair_ids? Uses the prereg seed PCG64(20261008)
so the count is representative; it also reports a pure greedy capacity (all strata, sorted order).
usage: feasibility.py OUTDIR trial_sample.json"""
import json, sys, collections
import numpy as np
out, trial = sys.argv[1], json.load(open(sys.argv[2]))
excl = set(trial['smoke']) | set(trial['pilot'])
res = {}
for proj in ['django', 'sympy', 'xarray', 'pytest', 'sphinx', 'fastapi']:
    C = sorted((json.loads(l) for l in open(f'{out}/{proj}/candidates.jsonl')), key=lambda c: c['pair_id'])
    cand = [c for c in C if c['reason'] == 'candidate']
    pool_all = [c for c in cand if c['pair_id'] not in excl]
    used = collections.Counter(); chosen = []
    rng = np.random.Generator(np.random.PCG64(20261008))
    quota = {'O1': 17, 'O2': 17, 'O3': 16}; got = {}
    def take(c):
        if used[c['prA']] >= 2 or used[c['prB']] >= 2: return False
        used[c['prA']] += 1; used[c['prB']] += 1; chosen.append(c['pair_id']); return True
    for st in ['O1', 'O2', 'O3']:
        pool = [c for c in pool_all if c['stratum'] == st]; k = 0
        for i in (rng.permutation(len(pool)) if pool else []):
            if k >= quota[st]: break
            if take(pool[int(i)]): k += 1
        got[st] = k
    short = 50 - len(chosen); bf = collections.Counter()
    rng2 = np.random.Generator(np.random.PCG64(20261008 + 1))
    for st in ['O1', 'O2', 'O3']:
        pool = [c for c in pool_all if c['stratum'] == st and c['pair_id'] not in set(chosen)]
        for i in (rng2.permutation(len(pool)) if pool else []):
            if short <= 0: break
            if take(pool[int(i)]): short -= 1; bf[st] += 1
    # capacity: greedy over all candidates in sorted order (lower bound of the true max under the cap)
    u2 = collections.Counter(); cap = 0
    for c in pool_all:
        if u2[c['prA']] < 2 and u2[c['prB']] < 2: u2[c['prA']] += 1; u2[c['prB']] += 1; cap += 1
    res[proj] = {'candidates': len(cand), 'excluded_trial_pairs': len(cand) - len(pool_all),
                 'by_stratum': dict(collections.Counter(c['stratum'] for c in pool_all)),
                 'dryrun_drawn': len(chosen), 'dryrun_by_stratum_quota_phase': got, 'dryrun_backfill': dict(bf),
                 'greedy_capacity_cap2': cap, 'reach_50': len(chosen) >= 50}
json.dump(res, open(f'{out}/feasibility_dryrun.json', 'w'), indent=1, sort_keys=True)
for k, v in res.items(): print(k, v)
