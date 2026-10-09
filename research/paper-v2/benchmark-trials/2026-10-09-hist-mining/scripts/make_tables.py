#!/usr/bin/env python3
"""Builds out/summary_tables.json + out/summary_tables.md from build_meta / candidates / feasibility / v1.1 estimate."""
import json, collections
P = ['django', 'sympy', 'xarray', 'pytest', 'sphinx', 'fastapi']
feas = json.load(open('out/feasibility_dryrun.json'))
T, md = {}, []
md.append('| project | PRs in window | eligible PRs | PR exclusions | pairs considered | drift | other pair excl. | candidates | O1 (identical / divergent) | O2 | O3 | O0 available | 50 reachable (dry-run) | greedy cap (max 2/PR) |')
md.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for p in P:
    m = json.load(open(f'out/{p}/build_meta.json'))
    pairs = [json.loads(l) for l in open(f'out/{p}/pairs_eligible.jsonl')]
    o1i = o1d = 0
    for c in pairs:
        if c['stratum'] != 'O1': continue
        A, B = c['writers']; ident = True
        for x in A['hunks']:
            for y in B['hunks']:
                if x['path'] != y['path'] or x['path'] not in c['common_files']: continue
                touch = (x['start'] < y['end'] and y['start'] < x['end']) or x['start'] == y['start'] or x['end'] == y['start'] or y['end'] == x['start']
                if touch and not (x['start'] == y['start'] and x['end'] == y['end'] and x['post'] == y['post']): ident = False
        o1i += ident; o1d += (not ident)
    pr = m['pr_reasons']; pc = m['pair_reasons']; st = m['strata']
    v = json.load(open(f'out/{p}/v11_prerebase_summary.json'))
    T[p] = {'prs_in_window': sum(pr.values()), 'pr_reasons': pr, 'pair_reasons': pc, 'strata': st, 'O1_identical': o1i, 'O1_divergent': o1d,
            'o0_available': m['o0_control_pairs_available'], 'feasibility': feas[p], 'v11_prerebase': v['outcomes'], 'default_tip': m['default_tip']}
    excl = ', '.join(f'{k} {v}' for k, v in sorted(pr.items()) if k != 'eligible')
    other = ', '.join(f'{k} {v}' for k, v in sorted(pc.items()) if k not in ('candidate', 'drift')) or '0'
    md.append(f"| {p} | {sum(pr.values())} | {pr.get('eligible',0)} | {excl} | {sum(pc.values())} | {pc.get('drift',0)} | {other} | {pc.get('candidate',0)} | {st.get('O1',0)} ({o1i} / {o1d}) | {st.get('O2',0)} | {st.get('O3',0)} | {m['o0_control_pairs_available']} | {'yes' if feas[p]['reach_50'] else 'no'} ({feas[p]['dryrun_drawn']}) | {feas[p]['greedy_capacity_cap2']} |")
json.dump(T, open('out/summary_tables.json', 'w'), indent=1, sort_keys=True)
open('out/summary_tables.md', 'w').write('\n'.join(md) + '\n')
print('\n'.join(md))
