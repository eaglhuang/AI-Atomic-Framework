#!/usr/bin/env python3
"""r2 analysis-only rebuild of E1–E5 per-cell metrics from raw cells (Phase 1 E).
READ-ONLY on runs/<cell>/; writes only to --out. Compares each recomputed cell with the r1 *_compare_raw.json value.
Raw inputs per cell: meta.json (wall_clock_ms, seeds), <mode>/artifacts/oracle_results.jsonl (terminal outcome + v1 verdict),
and (if present) the v2 rescore (runs/r2-oracle-rescore/rescore_cells.json, itself rebuilt from raw bytes).
Aggregates report ratio-of-sums AND mean-of-ratios separately; mean±pstdev is NOT a 95% CI (labelled as such)."""
import argparse, json, os, statistics as st, collections, math
ap = argparse.ArgumentParser(); ap.add_argument('--runs'); ap.add_argument('--out'); ap.add_argument('--rescore')
A = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS = A.runs or os.path.join(ROOT, 'runs')
OUT = A.out or os.path.join(ROOT, 'runs', 'r2-analysis', 'tables'); os.makedirs(OUT, exist_ok=True)
RES = A.rescore or os.path.join(RUNS, 'r2-oracle-rescore', 'rescore_cells.json')
v2 = {r['cell']: r for r in json.load(open(RES))['rows']} if os.path.exists(RES) else {}

def cell_metrics(cell):
    d = os.path.join(RUNS, cell)
    meta = json.load(open(os.path.join(d, 'meta.json')))
    mode = 'atm' if os.path.exists(os.path.join(d, 'atm', 'artifacts', 'oracle_results.jsonl')) else 'control'
    p = os.path.join(d, mode, 'artifacts', 'oracle_results.jsonl')
    if not os.path.exists(p): return None
    rows = [json.loads(l) for l in open(p) if l.strip()]
    wall = (meta.get('modes', {}).get(mode) or {}).get('wall_clock_ms')
    c = collections.Counter(r['oracle_verdict'] for r in rows); t = collections.Counter(r['terminal_outcome'] for r in rows)
    correct = c.get('correct', 0)
    out = dict(cell=cell, mode=mode, offered=len(rows), eligible=sum(1 for r in rows if r.get('eligible', True)),
        correct=correct, lost=c.get('lost', 0), committed=t.get('commit', 0), blocked=t.get('blocked', 0),
        rejects=t.get('reject', 0), unresolved=c.get('unresolved', 0), wall_ms=wall,
        goodput=round(correct / (wall / 1000), 2) if wall else None,
        workload_seed=meta.get('workload_seed', meta.get('scenario_seed')), scheduler_seed=meta.get('scheduler_seed'),
        scenario_hash=meta.get('scenario_hash'), arm=meta.get('arm') or (meta.get('params') or {}).get('arm'),
        arm_role=meta.get('arm_role'), procs=meta.get('procs'), window=(meta.get('params') or {}).get('compose_window_ms'))
    if cell in v2: out.update(v2_correct=v2[cell]['v2_correct'], v2_lost=v2[cell]['v2_lost'], v2_frame_violation_files=v2[cell]['files_frame_violation'])
    return out

STAGES = {
  'e1': ('runs/e1-pilot/e1_compare_raw.json', 'run', dict(correct='correct', lost='lost', committed='committed', blocked='blocked', wall_ms='wall_clock_ms')),
  'e2': ('runs/e2-matrix/e2_compare_raw.json', 'run', dict(offered='offered', correct='correct', lost='lost', committed='committed', blocked='blocked', wall_ms='wall_clock_ms', goodput='goodput_correct_per_wall_s')),
  'e3': ('runs/e3-sweep/e3_compare_raw.json', 'run_id', dict(offered='offered', correct='correct', lost='lost', committed='commits', blocked='blocked', wall_ms='wall_ms', goodput='goodput')),
  'e4': ('runs/e4-multiprocess/e4_compare_raw.json', 'run_id', dict(offered='offered', correct='correct', lost='lost', committed='commits', blocked='blocked', wall_ms='wall_ms', goodput='goodput')),
}
allcells, mism, summary = [], [], {}
for st_id, (ref, key, fmap) in STAGES.items():
    refd = json.load(open(os.path.join(ROOT, ref)))
    n = ok = 0
    for rc in refd['cells']:
        m = cell_metrics(rc[key]);
        if m is None: mism.append(dict(stage=st_id, cell=rc[key], field='*', r1=None, rebuilt='missing raw')); continue
        m.update(stage=st_id, workload=rc.get('workload'), r1_arm=rc.get('arm') or rc.get('kind'))
        cell_ok = True
        for mf, rf in fmap.items():
            if rf not in rc: continue
            a, b = m.get(mf), rc[rf]
            same = (a == b) if not isinstance(b, float) else (a is not None and abs(a - b) <= 0.011)
            if not same: cell_ok = False; mism.append(dict(stage=st_id, cell=rc[key], field=mf, r1=b, rebuilt=a))
        n += 1; ok += cell_ok; allcells.append(m)
    summary[st_id] = dict(cells=n, cells_all_fields_match=ok)
# E5: runner cells only (probe cells are inject.mts outputs — classes, not logical ops)
e5 = [cell_metrics(c) for c in sorted(os.listdir(RUNS)) if c.startswith('e5-occ_exhaust') or c.startswith('e5-clean_steward')]
for m in e5: m.update(stage='e5', workload='hot_conflict'); allcells.append(m)
summary['e5_logical_ops'] = {k: dict(cells=len(v), offered=sum(x['offered'] for x in v), correct=sum(x['correct'] for x in v),
    blocked=sum(x['blocked'] for x in v), lost=sum(x['lost'] for x in v)) for k, v in
    {'occ_exhaust': [m for m in e5 if 'occ_exhaust' in m['cell']], 'clean_steward': [m for m in e5 if 'clean_steward' in m['cell']]}.items()}

def grp_key(m):
    if m['stage'] == 'e3': return (m['stage'], m['workload'], m['r1_arm'], f"w{m['window']}")
    if m['stage'] == 'e4': return (m['stage'], m['workload'] or 'hot_conflict', m['r1_arm'], f"p{m['procs'] or 'sp'}")
    if m['stage'] == 'e5': return (m['stage'], m['workload'], 'occ_exhaust' if 'occ' in m['cell'] else 'clean_steward', '')
    return (m['stage'], m['workload'], m['r1_arm'], '')
G = collections.OrderedDict()
for m in allcells: G.setdefault(grp_key(m), []).append(m)
agg = []
for k, v in G.items():
    off = sum(x['offered'] for x in v); cor = sum(x['correct'] for x in v)
    rates = [x['correct'] / x['offered'] for x in v if x['offered']]
    gps = [x['goodput'] for x in v if x['goodput'] is not None]
    agg.append(dict(stage=k[0], workload=k[1], arm=k[2], sub=k[3], n=len(v), offered=off, correct=cor,
        v2_correct=sum(x.get('v2_correct', 0) or 0 for x in v), lost=sum(x['lost'] for x in v), blocked=sum(x['blocked'] for x in v),
        rate_ratio_of_sums=round(cor / off, 4) if off else None, rate_mean_of_ratios=round(st.mean(rates), 4) if rates else None,
        goodput_mean=round(st.mean(gps), 2) if gps else None, goodput_pstdev=round(st.pstdev(gps), 2) if len(gps) > 1 else None,
        per_seed=[(x['workload_seed'], x['scheduler_seed'], x['correct'], x['offered'], x['goodput']) for x in v]))
json.dump(dict(summary=summary, mismatches=mism, cells=allcells, aggregates=agg), open(os.path.join(OUT, 'rebuilt_tables.json'), 'w'), indent=1)
L = ['# Analysis-only rebuild（r2 Phase 1 E）', '', '從 raw cell 重算；與 r1 `*_compare_raw.json` 逐格比對（整數須相等，浮點容差 0.011）。', '',
     '| stage | cells | 全欄位相符 |', '|---|---|---|'] + [f"| {k} | {v['cells']} | {v['cells_all_fields_match']} |" for k, v in summary.items() if k.startswith('e') and 'cells' in v]
L += ['', f"不符欄位數：{len(mism)}", '']
if mism: L += ['| stage | cell | field | r1 | rebuilt |', '|---|---|---|---|---|'] + [f"| {x['stage']} | {x['cell']} | {x['field']} | {x['r1']} | {x['rebuilt']} |" for x in mism[:200]]
L += ['', '## E5 logical operations（runner cells；非 18 個 cell 分類）', '', '| 類 | cells | offered | correct | blocked | lost |', '|---|---|---|---|---|---|']
L += [f"| {k} | {v['cells']} | {v['offered']} | {v['correct']} | {v['blocked']} | {v['lost']} |" for k, v in summary['e5_logical_ops'].items()]
L += ['', '## 彙總（ratio-of-sums 與 mean-of-ratios 分開；goodput mean±母體σ **不是** 95% CI）', '',
      '| stage | workload | arm | sub | n | offered | correct (v1) | correct (v2) | lost | blocked | rate RoS | rate MoR | goodput mean±σ |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
L += [f"| {a['stage']} | {a['workload']} | {a['arm']} | {a['sub']} | {a['n']} | {a['offered']} | {a['correct']} | {a['v2_correct']} | {a['lost']} | {a['blocked']} | {a['rate_ratio_of_sums']} | {a['rate_mean_of_ratios']} | {a['goodput_mean']}±{a['goodput_pstdev']} |" for a in agg]
open(os.path.join(OUT, 'REBUILD_SUMMARY.md'), 'w').write('\n'.join(L) + '\n')
print('\n'.join(L[:14 + min(len(mism), 30)]))
print(json.dumps(summary['e5_logical_ops']))
