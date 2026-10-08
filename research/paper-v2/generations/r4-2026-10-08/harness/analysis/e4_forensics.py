#!/usr/bin/env python3
"""r2 P0-1 analysis-only aggregation of E4 forensic replays (runs/r2f-*). Read-only on runs/; writes runs/r2-e4-forensics/."""
import json, glob, os, re, collections, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(ROOT, 'runs')
RESCORE = os.environ.get('RESCORE') or os.path.join(R, 'r2-oracle-rescore', 'rescore_cells.json')
OUTD = os.environ.get('OUT') or os.path.join(R, 'r2-e4-forensics')
v2 = {r['cell']: r for r in json.load(open(RESCORE))['rows']}
cells = []
for d in sorted(glob.glob(os.path.join(R, 'r2f-e4-*'))):
    cell = os.path.basename(d)
    m = re.match(r'r2f-e4-p(\d+)-s(\d+)-(?:(g)-)?(r1cfg|slock)-r(\d+)$', cell)
    if not m: continue
    procs, seed, grid, cfg, rep = int(m[1]), int(m[2]), bool(m[3]), m[4], int(m[5])
    a = os.path.join(d, 'atm')
    orr = [json.loads(l) for l in open(os.path.join(a, 'artifacts', 'oracle_results.jsonl'))]
    lost = [r['intent_id'] for r in orr if r['oracle_verdict'] == 'lost']
    tel = [json.loads(l) for f in glob.glob(os.path.join(a, 'artifacts', 'steward_applies.w*.jsonl')) for l in open(f)]
    spins = sum(json.load(open(f))['broker_stats'].get('apply_lock_spins', 0) for f in glob.glob(os.path.join(a, 'mp', 'worker-*.json')))
    pids = collections.defaultdict(set)
    for f in glob.glob(os.path.join(a, 'events', '*.jsonl')):
        for l in open(f):
            e = json.loads(l)
            if e.get('event') == 'decision' and e.get('batch_id'): pids[e['batch_id']].add(e['pid'])
    meta = json.load(open(os.path.join(d, 'meta.json')))
    vr = v2.get(cell, {})
    cells.append(dict(cell=cell, procs=procs, seed=seed, grid=grid, cfg=cfg, rep=rep,
        arm=meta.get('arm'), arm_role=meta.get('arm_role'),
        offered=len(orr), committed=sum(r['terminal_outcome'] == 'commit' for r in orr),
        blocked=sum(r['terminal_outcome'] == 'blocked' for r in orr),
        v1_correct=sum(r['oracle_verdict'] == 'correct' for r in orr), v1_lost=len(lost), lost_intents=lost,
        v2_correct=vr.get('v2_correct'), v2_lost=vr.get('v2_lost'), v2_frame_violation_files=vr.get('files_frame_violation'),
        v2_fail_committed=(vr.get('v2_by_verdict', {}).get('lost', 0) + vr.get('v2_by_verdict', {}).get('frame_violation', 0) + vr.get('v2_by_verdict', {}).get('duplicate', 0)),
        applies=len(tel), applies_written=sum(t.get('written', False) for t in tel),
        interleave_suspect=sum(t.get('interleave_suspect', False) for t in tel),
        post_write_drift=sum(t.get('post_write_drift', False) for t in tel),
        apply_lock_spins=spins, batch_id_collisions=sum(1 for p in pids.values() if len(p) > 1)))
agg = collections.OrderedDict()
def add(key, c):
    a = agg.setdefault(key, dict(runs=0, runs_with_v1_lost=0, v1_lost=0, runs_with_v2_fail=0, v2_lost=0, v2_frame_violation_files=0,
        interleave_suspect=0, runs_with_interleave=0, post_write_drift=0, apply_lock_spins=0, batch_id_collisions=0, offered=0, committed=0, v1_correct=0, v2_correct=0, blocked=0))
    a['runs'] += 1; a['runs_with_v1_lost'] += c['v1_lost'] > 0; a['v1_lost'] += c['v1_lost']
    a['runs_with_v2_fail'] += (c['v2_fail_committed'] or 0) > 0; a['v2_lost'] += c['v2_lost'] or 0; a['v2_frame_violation_files'] += c['v2_frame_violation_files'] or 0
    a['interleave_suspect'] += c['interleave_suspect']; a['runs_with_interleave'] += c['interleave_suspect'] > 0
    a['post_write_drift'] += c['post_write_drift']; a['apply_lock_spins'] += c['apply_lock_spins']; a['batch_id_collisions'] += c['batch_id_collisions']
    for k in ('offered', 'committed', 'v1_correct', 'v2_correct', 'blocked'): a[k] += c[k] or 0
for c in cells:
    add(('A_exact_cell' if not c['grid'] else 'B_grid', c['cfg'], c['procs'], c['seed'] if not c['grid'] else c['seed']), c)
tot = collections.OrderedDict()
for c in cells:
    k = (c['cfg'],)
    t = tot.setdefault(k, dict(runs=0, runs_with_v2_fail=0, v1_lost=0, v2_lost=0, v2_frame_violation_files=0, interleave_suspect=0, runs_with_interleave=0))
    t['runs'] += 1; t['runs_with_v2_fail'] += (c['v2_fail_committed'] or 0) > 0; t['v1_lost'] += c['v1_lost']; t['v2_lost'] += c['v2_lost'] or 0
    t['v2_frame_violation_files'] += c['v2_frame_violation_files'] or 0; t['interleave_suspect'] += c['interleave_suspect']; t['runs_with_interleave'] += c['interleave_suspect'] > 0
# correlation: every v1/v2 failure run has an interleave signature?
fail_runs = [c for c in cells if (c['v2_fail_committed'] or 0) > 0]
lost_intent_freq = collections.Counter(i for c in cells if c['cfg'] == 'r1cfg' and c['procs'] == 2 and c['seed'] == 17 and not c['grid'] for i in c['lost_intents'])
lost_intent_all = [dict(cell=c['cell'], lost=c['lost_intents'], interleave=c['interleave_suspect'], frame_viol_files=c['v2_frame_violation_files']) for c in cells if (c['v2_fail_committed'] or 0) > 0]
# cost of the steward lock: wall clock + correct/blocked per cfg x procs
import statistics as st
for c in cells:
    try: c['wall_clock_ms'] = json.load(open(os.path.join(R, c['cell'], 'meta.json')))['modes']['atm']['wall_clock_ms']
    except Exception: c['wall_clock_ms'] = None
cost = collections.OrderedDict()
for c in sorted(cells, key=lambda c: (c['procs'], c['cfg'])):
    cost.setdefault((c['procs'], c['cfg']), []).append(c)
out = dict(cells=cells, agg=[dict(group=list(k), **v) for k, v in agg.items()], totals=[dict(cfg=k[0], **v) for k, v in tot.items()],
    fail_runs_with_interleave=sum(c['interleave_suspect'] > 0 for c in fail_runs), fail_runs=len(fail_runs),
    fail_runs_with_any_signature=sum((c['interleave_suspect'] + c['post_write_drift']) > 0 for c in fail_runs),
    runs_with_any_signature_by_cfg={cfg: sum((c['interleave_suspect'] + c['post_write_drift']) > 0 for c in cells if c['cfg'] == cfg) for cfg in ('r1cfg', 'slock')},
    post_write_drift_by_cfg={cfg: sum(c['post_write_drift'] for c in cells if c['cfg'] == cfg) for cfg in ('r1cfg', 'slock')},
    lost_intent_freq_exact_cell_r1cfg=dict(lost_intent_freq), failure_runs=lost_intent_all,
    cost=[dict(procs=k[0], cfg=k[1], runs=len(v), mean_v1_correct=round(st.mean(x['v1_correct'] for x in v), 2),
      mean_blocked=round(st.mean(x['blocked'] for x in v), 2),
      mean_wall_clock_ms=round(st.mean(x['wall_clock_ms'] for x in v if x['wall_clock_ms'] is not None), 1) if any(x['wall_clock_ms'] is not None for x in v) else None)
      for k, v in cost.items()])
os.makedirs(OUTD, exist_ok=True)
json.dump(out, open(os.path.join(OUTD, 'forensics_summary.json'), 'w'), indent=1)
L = ['| group | cfg | procs | seed | runs | runs v1 lost>0 | v1 lost | runs v2 fail>0 | v2 lost | v2 frame-viol files | interleave sig | runs w/ interleave | steward lock spins | batch-id collisions |',
     '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
for k, v in agg.items():
    L.append(f"| {k[0]} | {k[1]} | {k[2]} | {k[3]} | {v['runs']} | {v['runs_with_v1_lost']} | {v['v1_lost']} | {v['runs_with_v2_fail']} | {v['v2_lost']} | {v['v2_frame_violation_files']} | {v['interleave_suspect']} | {v['runs_with_interleave']} | {v['apply_lock_spins']} | {v['batch_id_collisions']} |")
L.append(''); L.append('| cfg | runs | runs v2 fail>0 | v1 lost | v2 lost | v2 frame-viol files | interleave sig | runs w/ interleave |'); L.append('|---|---|---|---|---|---|---|---|')
for k, v in tot.items(): L.append(f"| {k[0]} | {v['runs']} | {v['runs_with_v2_fail']} | {v['v1_lost']} | {v['v2_lost']} | {v['v2_frame_violation_files']} | {v['interleave_suspect']} | {v['runs_with_interleave']} |")
L.append(''); L.append(f"failure runs with interleave signature (receipt_before != pre_apply): {out['fail_runs_with_interleave']}/{out['fail_runs']}")
L.append(f"failure runs with ANY race signature (interleave or post_write_drift): {out['fail_runs_with_any_signature']}/{out['fail_runs']}")
L.append(f"runs with any race signature by cfg: {out['runs_with_any_signature_by_cfg']}; post_write_drift events by cfg: {out['post_write_drift_by_cfg']}")
L.append(f"lost intents in exact cell (p2 s17 r1cfg, 30 reps, not grid): {dict(lost_intent_freq)}")
L.append(''); L.append('failure runs: ' + json.dumps(lost_intent_all, ensure_ascii=False))
L.append(''); L.append('| procs | cfg | runs | mean v1 correct | mean blocked | mean wall_clock_ms |'); L.append('|---|---|---|---|---|---|')
for x in out['cost']: L.append(f"| {x['procs']} | {x['cfg']} | {x['runs']} | {x['mean_v1_correct']} | {x['mean_blocked']} | {x['mean_wall_clock_ms']} |")
open(os.path.join(OUTD, 'forensics_table.md'), 'w').write('\n'.join(L) + '\n')
print('\n'.join(L))
