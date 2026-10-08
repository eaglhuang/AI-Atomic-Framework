#!/usr/bin/env python3
"""r3 analysis-only comparison (READ-ONLY on runs/*; writes only to --out).
Inputs: oracle v2 artifact-only rescore (rescore_cells.json), per-run meta/events/compose_batches/steward_applies,
barrier results (runs/r3-validation/barrier/*/barrier_result.json), PINS.json.
Outputs: r3_summary.json + R3_TABLES.md.
Definitions:
  failed run      = any op with a failing v2 verdict, or any file frame/structure violation, foreign write or extra file.
  lost effect     = v2 verdict 'lost' (committed/applied op whose effect is absent).
  corrupted file  = file with frame or structure violation (incl. torn tails).
  non-completion  = op not 'correct' and not failing (e.g. blocked_absent); counted in goodput as NOT done.
  re-compose      = batch whose ATM canonical-commit guard was reached and base mismatched: observed as
                    atm_commit_attempts>=2 (re-compose then applied) or attempts>=1 & blocked (re-compose then blocked).
  goodput         = correct ops / wall-clock s (per run, then mean); also ratio-of-sums.
  percentiles     = linear interpolation (numpy 'linear'); mean±sd is NOT a CI.
"""
import argparse, glob, json, os, re, statistics as st
from collections import Counter, defaultdict
ap = argparse.ArgumentParser(); ap.add_argument('--rescore', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--runs', default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'runs'))
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True); RUNS = A.runs
RES = {r['cell']: r for r in json.load(open(A.rescore))['rows'] if r['mode'] == 'atm'}
ARM_RE = re.compile(r'-(old|fixlock|fix)(?:-r\d+)?$')
def pct(xs, q):
  xs = sorted(xs)
  if not xs: return None
  k = (len(xs) - 1) * q; f = int(k); c = min(f + 1, len(xs) - 1); return xs[f] + (xs[c] - xs[f]) * (k - f)
def stats(xs):
  xs = [x for x in xs if x is not None]
  return dict(n=len(xs), mean=round(st.mean(xs), 2) if xs else None, p50=round(pct(xs, .5), 2) if xs else None,
              p95=round(pct(xs, .95), 2) if xs else None, sd=round(st.pstdev(xs), 2) if len(xs) > 1 else None)
def jl(paths):
  for p in paths:
    for l in open(p):
      l = l.strip()
      if l: yield json.loads(l)
def classify(b):
  r = (b.get('blocked_reason') or '')
  if b.get('steward_verdict') == 'applied': return 'applied_after_re-compose' if (b.get('atm_commit_attempts') or 0) >= 2 else 'applied'
  if r.startswith('re-compose:'): return 'blocked:re-compose(exhausted)'
  if r.startswith('recovery-required:'): return 'blocked:recovery-required'
  pre = r.split(':')[0][:40] if r else 'none'
  if 'canonical target base hash is stale' in r: pre = 'stale-precheck(unlocked)'
  if (b.get('atm_commit_attempts') or 0) >= 1: return f'blocked:re-compose→{pre}'
  return f'blocked:{pre}'
def run_row(cell):
  d = os.path.join(RUNS, cell); meta = json.load(open(os.path.join(d, 'meta.json'))); m = ARM_RE.search(cell)
  arm = m.group(1) if m else None; res = RES.get(cell)
  art = os.path.join(d, 'atm', 'artifacts'); ev = os.path.join(d, 'atm', 'events')
  cb = sorted(glob.glob(os.path.join(art, 'compose_batches.w*.jsonl'))) or [os.path.join(ev, 'compose_batches.jsonl')]
  cb = [p for p in cb if os.path.exists(p)]
  batches = list(jl(cb)) if cb else []
  sa = sorted(glob.glob(os.path.join(art, 'steward_applies*.jsonl'))); applies = list(jl(sa)) if sa else []
  dec = [e for e in jl(sorted(glob.glob(os.path.join(ev, '*.jsonl')))) if e.get('event') == 'decision']
  bcls, icls = Counter(), Counter()
  for b in batches:
    c = classify(b); bcls[c] += 1; icls[c] += len(b.get('intent_ids') or b.get('proposalIds') or [])
  rc_events = sum(1 for b in batches if (b.get('atm_commit_attempts') or 0) >= 2 or ((b.get('atm_commit_attempts') or 0) >= 1 and b.get('steward_verdict') != 'applied'))
  pin = '5692474f' if '5692474f' in (meta.get('atm_version') or '') else 'bea35380' if 'bea35380' in (meta.get('atm_version') or '') else None
  wall = (meta.get('modes', {}).get('atm') or {}).get('wall_clock_ms')
  fail = None
  if res:
    fail = bool(res['v2_fail'] or res['files_frame_violation'] or res['files_structure_violation'] or res['foreign_writes'] or res['extra_files'])
  return dict(cell=cell, arm=arm, pin=pin, procs=meta.get('procs') or (meta.get('params') or {}).get('procs'),
    seed=meta.get('workload_seed'), sched=meta.get('scheduler_seed'), process_model=meta.get('process_model'),
    meta_arm=meta.get('arm'), mp_ablation=meta.get('mp_ablation'), scored=res is not None,
    offered=res['n_ops'] if res else None, correct=res['v2_correct'] if res else None, lost=res['v2_lost'] if res else None,
    v2_fail=res['v2_fail'] if res else None, by_verdict=res['v2_by_verdict'] if res else None,
    frame_files=res['files_frame_violation'] if res else None, structure_files=res['files_structure_violation'] if res else None,
    extra_files=res['extra_files'] if res else None, foreign_writes=res['foreign_writes'] if res else None, failed=fail,
    wall_ms=wall, goodput=(res['v2_correct'] / (wall / 1000)) if res and wall else None,
    batches=len(batches), batch_classes=dict(bcls), intent_classes=dict(icls), re_compose_events=rc_events,
    lock_contention_polls=sum((b.get('atm_commit_lock_contention_polls') or 0) for b in batches),
    sig_interleave=sum(1 for a in applies if a.get('interleave_suspect')), sig_drift=sum(1 for a in applies if a.get('post_write_drift')),
    harness_lock_wait_ms=sum((a.get('lock_wait_ms') or 0) for a in applies),
    total_ms=[e.get('total_ms') for e in dec], apply_ms=[e.get('apply_ms') for e in dec],
    outcomes=dict(Counter(e.get('outcome') for e in dec)))
def agg(rows):
  rows = [r for r in rows if r['scored']]
  if not rows: return None
  s = lambda k: sum(r[k] or 0 for r in rows)
  ic, bc = Counter(), Counter()
  for r in rows: ic.update(r['intent_classes']); bc.update(r['batch_classes'])
  wall = [r['wall_ms'] for r in rows]
  return dict(runs=len(rows), failed_runs=sum(1 for r in rows if r['failed']), lost_effects=s('lost'),
    corrupted_files=s('frame_files') + s('structure_files'), extra_files=sum(len(r['extra_files'] or []) for r in rows),
    foreign_writes=sum(len(r['foreign_writes'] or []) for r in rows), offered=s('offered'), correct=s('correct'),
    non_completion=s('offered') - s('correct') - sum((r['v2_fail'] or 0) for r in rows), v2_fail_ops=s('v2_fail'),
    mean_correct_per_run=round(s('correct') / len(rows), 2), completion_rate=round(s('correct') / s('offered'), 4),
    goodput_mean_per_run=round(st.mean([r['goodput'] for r in rows if r['goodput']]), 2),
    goodput_ratio_of_sums=round(s('correct') / (sum(wall) / 1000), 2), wall_ms=stats(wall),
    re_compose_events=s('re_compose_events'), lock_contention_polls=s('lock_contention_polls'),
    sig_interleave=s('sig_interleave'), sig_drift=s('sig_drift'), batch_classes=dict(bc), intent_classes=dict(ic),
    intent_total_ms=stats([x for r in rows for x in r['total_ms']]), intent_apply_ms=stats([x for r in rows for x in r['apply_ms']]))
cells = sorted(c for c in os.listdir(RUNS) if re.match(r'r3[vmrs]-', c) and os.path.exists(os.path.join(RUNS, c, 'meta.json')))
rows = [run_row(c) for c in cells]
out = dict(definitions=__doc__, n_cells=len(rows), unscored=[r['cell'] for r in rows if not r['scored']])
# replay
rv = [r for r in rows if r['cell'].startswith('r3v-')]
exact = lambda r: re.match(r'r3v-e4-p2-s17-(old|fix|fixlock)-r\d+$', r['cell']) or re.match(r'r3v-e4-p2-s17-g-', r['cell'])
out['replay'] = {a: dict(all=agg([r for r in rv if r['arm'] == a]), p2_s17_35=agg([r for r in rv if r['arm'] == a and exact(r)]),
                         **{f'grid_p{p}': agg([r for r in rv if r['arm'] == a and '-g-' in r['cell'] and r['procs'] == p]) for p in (2, 4, 8)})
                 for a in ('old', 'fix', 'fixlock')}
out['replay_failures'] = [{k: r[k] for k in ('cell', 'arm', 'lost', 'v2_fail', 'frame_files', 'structure_files', 'extra_files', 'foreign_writes', 'by_verdict', 'sig_interleave', 'sig_drift')} for r in rv if r['failed']]
# matrix
rm = [r for r in rows if r['cell'].startswith('r3m-')]
def mtype(c):
  return 'main_p2' if '-steward-p2-' in c else 'main_p4' if '-steward-p4-' in c else 'main_p8' if '-steward-p8-' in c else 'sp' if '-steward-sp-' in c else 'fault_naive_p8' if 'fault_naive' in c else 'fault_nolock_p8' if 'fault_nolock' in c else '?'
out['matrix'] = {a: {t: agg([r for r in rm if r['arm'] == a and mtype(r['cell']) == t]) for t in ('main_p2', 'main_p4', 'main_p8', 'sp', 'fault_naive_p8', 'fault_nolock_p8')} for a in ('old', 'fix', 'fixlock')}
out['matrix_failures'] = [{k: r[k] for k in ('cell', 'arm', 'lost', 'v2_fail', 'frame_files', 'structure_files', 'extra_files', 'by_verdict')} for r in rm if r['failed']]
# regression (single process)
rr = [r for r in rows if r['cell'].startswith('r3r-')]
reg = {}
for armname in ('steward', 'file_lock', 'occ', 'git_three_way', 'bare_composer'):
  for wl in ('hot_conflict', 'hot_disjoint', 'cold', 'ALL'):
    sel = lambda pin, rep=None: [r for r in rr if f'-{armname}-' in r['cell'] and (wl == 'ALL' or r['cell'].startswith(f'r3r-e2-{wl}-'))
                                 and r['arm'] == pin and (rep is None or f'-r{rep}-' in r['cell'])]
    o, f = agg(sel('old')), agg(sel('fix'))
    if not o or not f: continue
    d = {}
    for k in ('intent_total_ms', 'intent_apply_ms', 'wall_ms'):
      d[k] = {q: (round(f[k][q] - o[k][q], 2), round((f[k][q] - o[k][q]) / o[k][q] * 100, 1) if o[k][q] else None) for q in ('mean', 'p50', 'p95')}
    # noise reference: same pin, rep1 vs rep2
    noise = {}
    for pin in ('old', 'fix'):
      a1, a2 = agg(sel(pin, 1)), agg(sel(pin, 2))
      if a1 and a2:
        noise[pin] = {k: {q: round(a2[k][q] - a1[k][q], 2) for q in ('mean', 'p50', 'p95')} for k in ('intent_total_ms', 'intent_apply_ms')}
    reg[f'{armname}/{wl}'] = dict(old=o, fix=f, delta_fix_minus_old=d, noise_rep2_minus_rep1=noise,
      correctness_same=(o['correct'], o['lost_effects'], o['failed_runs']) == (f['correct'], f['lost_effects'], f['failed_runs']))
out['regression'] = reg
# SP noise addendum (r3s-*: 5 reps x seeds 11/17/23 x pin) + the 3 r3m SP cells per pin
sp = [r for r in rows if r['cell'].startswith('r3s-') or '-steward-sp-' in r['cell']]
out['sp_noise'] = {a: dict(agg=agg([r for r in sp if r['arm'] == a]),
  per_seed={sd: sorted(r['correct'] for r in sp if r['arm'] == a and r['seed'] == sd) for sd in (11, 17, 23)}) for a in ('old', 'fix')}
# barrier
out['barrier'] = {os.path.basename(p): json.load(open(os.path.join(p, 'barrier_result.json')))['summary']
                  for p in sorted(glob.glob(os.path.join(RUNS, 'r3-validation', 'barrier', '*')))}
json.dump(out, open(os.path.join(A.out, 'r3_summary.json'), 'w'), indent=1, ensure_ascii=False)
json.dump([{k: v for k, v in r.items() if k not in ('total_ms', 'apply_ms')} for r in rows], open(os.path.join(A.out, 'r3_cells.json'), 'w'), indent=1)
# markdown
L = ['# r3 驗證表（ATM PR #213 merge bea35380 vs 5692474f）', '', '> DRAFT。不主張勝出。由 `analysis/r3_compare.py` 從 raw 重建（唯讀）。定義見 r3_summary.json `definitions`。', '']
def row(name, g):
  if not g: return f'| {name} | – |'
  return (f"| {name} | {g['runs']} | {g['failed_runs']} | {g['lost_effects']} | {g['corrupted_files']} | {g['extra_files']} | {g['offered']} | {g['correct']} | "
          f"{g['non_completion']} | {g['completion_rate']:.3f} | {g['mean_correct_per_run']} | {g['re_compose_events']} | "
          f"{g['wall_ms']['mean']} / {g['wall_ms']['p50']} / {g['wall_ms']['p95']} | {g['goodput_mean_per_run']} | {g['sig_interleave']}/{g['sig_drift']} |")
H = ('| 組 | runs | failed runs | lost effects | corrupted files | extra files | offered | correct | non-completion | completion | correct/run | re-compose | wall ms mean/p50/p95 | goodput (correct/s) | 簽章 interleave/drift |',
     '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|')
L += ['## 1. E4 replay（r2 forensics 同配置：每臂 75 runs，含 p2/s17 共 35 次）', '', *H]
for a in ('old', 'fix', 'fixlock'):
  for sub in ('all', 'p2_s17_35', 'grid_p2', 'grid_p4', 'grid_p8'): L.append(row(f'{a} · {sub}', out['replay'][a][sub]))
L += ['', '臂：old＝5692474f＋harness steward lock off；fix＝bea35380＋off（主比較）；fixlock＝bea35380＋on（次要）。', '']
L += ['### 1a. 非完成（intent 數，依最終 steward 結果分類）', '', '| 臂 | 分類 → intents |', '|---|---|']
for a in ('old', 'fix', 'fixlock'):
  ic = out['replay'][a]['all']['intent_classes'] if out['replay'][a]['all'] else {}
  L.append(f"| {a} | " + '; '.join(f'{k}: {v}' for k, v in sorted(ic.items())) + ' |')
L += ['', '## 2. E4 完整 cells（r1 同 seeds／flags）', '', *H]
for a in ('old', 'fix', 'fixlock'):
  for t, g in out['matrix'][a].items():
    if g: L.append(row(f'{a} · {t}', g))
L += ['', '### 2a. 單 process E4（sp）雜訊檢查：r3m 3 cells ＋ r3s 15 cells／pin（每 seed 6 次）', '', '| pin 臂 | runs | correct/offered | lost | failed runs | 每 seed correct 分布（s11 ; s17 ; s23） |', '|---|---:|---|---:|---:|---|']
for a in ('old', 'fix'):
  g = out['sp_noise'][a]['agg']; ps = out['sp_noise'][a]['per_seed']
  if g: L.append(f"| {a} | {g['runs']} | {g['correct']}/{g['offered']} | {g['lost_effects']} | {g['failed_runs']} | {ps[11]} ; {ps[17]} ; {ps[23]} |")
L += ['', '## 3. 單 process 回歸（E2 子集：3 workloads × 5 arms × seeds 11/17/23 × 2 reps）', '',
      '| arm/workload | correct old→fix | lost old/fix | failed runs old/fix | total_ms mean old→fix (Δ%) | p50 Δ | p95 Δ | apply_ms mean Δ (Δ%) | apply p95 Δ | 雜訊參考（同 pin rep2−rep1，total mean） |', '|---|---|---|---|---|---|---|---|---|---|']
for k, v in reg.items():
  o, f, d = v['old'], v['fix'], v['delta_fix_minus_old']; n = v['noise_rep2_minus_rep1']
  L.append(f"| {k} | {o['correct']}/{o['offered']} → {f['correct']}/{f['offered']} | {o['lost_effects']}/{f['lost_effects']} | {o['failed_runs']}/{f['failed_runs']} | "
           f"{o['intent_total_ms']['mean']} → {f['intent_total_ms']['mean']} ({d['intent_total_ms']['mean'][1]}%) | {d['intent_total_ms']['p50'][0]} | {d['intent_total_ms']['p95'][0]} | "
           f"{d['intent_apply_ms']['mean'][0]} ({d['intent_apply_ms']['mean'][1]}%) | {d['intent_apply_ms']['p95'][0]} | old {n.get('old', {}).get('intent_total_ms', {}).get('mean')} / fix {n.get('fix', {}).get('intent_total_ms', {}).get('mean')} |")
L += ['', '## 4. Barrier 2-process 交錯測試（確定性）', '', '| 案例 | window hit | lost effects | follower 結果 | 最終＝leader-only | 最終＝兩者 full bytes | 殘留檔 | follower commit-guard 次數 |', '|---|---|---|---|---|---|---|---|']
for k, b in out['barrier'].items():
  L.append(f"| {k} | {b['window_hit']}/{b['reps']} | {b['lost_effects_total']} | {b['follower_classes']} | {b['final_equals_leader_only']} | {b.get('final_equals_both_full_bytes')} | {b['leftover_files']} | {b['follower_commit_guard_attempts']} |")
open(os.path.join(A.out, 'R3_TABLES.md'), 'w').write('\n'.join(L) + '\n')
print(json.dumps({a: {k: out['replay'][a]['all'][k] for k in ('runs', 'failed_runs', 'lost_effects', 'corrupted_files', 'correct', 'non_completion', 're_compose_events')} for a in out['replay'] if out['replay'][a]['all']}, indent=0))
