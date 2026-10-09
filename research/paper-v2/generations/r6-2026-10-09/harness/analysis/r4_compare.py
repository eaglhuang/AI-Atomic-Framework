#!/usr/bin/env python3
"""r4 analysis-only comparison (READ-ONLY on runs/*; writes only to --out).
Inputs: oracle v2 artifact-only rescore (rescore_cells.json), per-run meta/compose_batches/steward_applies/events,
runs/r4-validation/barrier/*/barrier_result.json, runs/r4-validation/faults/fault_results.json, PINS.json.
Outputs: r4_summary.json + r4_cells.json + R4_TABLES.md.
Definitions (same as r3 unless noted):
  completed intent = ATM `applied` and oracle v2 finds the effect in the final bytes (v2 'correct').
  lost effect      = v2 verdict 'lost' (ATM acked `applied`, effect absent from final bytes). Counted per effect, not per failure.
  blocked intent   = intent whose batch ended `blocked` (incl. after re-compose); completed + lost + blocked = total intents.
  failed run       = any op with a failing v2 verdict, or any file frame/structure violation, foreign write or extra file.
  corrupted file   = file with frame or structure violation (incl. torn tails).
  attempts (r4)    = per batch max(atm_tx_attempts, atm_commit_attempts). atm_tx_attempts counts ATM's forwarded
                     commitHooks.beforePrecheck calls (2118bc66+ only; = transactional apply attempts, incl. those that end at
                     the unlocked early stale check); atm_commit_attempts counts commit-lock acquisitions (bea35380+). 5692474f: 0.
  re-compose event = batch with attempts>=2, or attempts>=1 and final `blocked` (the first attempt returned re-compose).
  re-compose success = batch `applied` with attempts>=2.
  percentiles      = linear interpolation (numpy 'linear'); mean±sd is NOT a CI.
"""
import argparse, glob, json, os, re, statistics as st
from collections import Counter
ap = argparse.ArgumentParser(); ap.add_argument('--rescore', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--runs', default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'runs'))
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True); RUNS = A.runs
RES = {r['cell']: r for r in json.load(open(A.rescore))['rows'] if r['mode'] == 'atm'}
ARMS = ('old', 'fix', 'opt', 'optlock', 'optr0', 'optr1')
ARM_RE = re.compile(r'-(old|fix|optlock|optr0|optr1|opt)(?:-r\d+)?$')
PIN_OF = {'old': '5692474f', 'fix': 'bea35380', 'opt': '2118bc66', 'optlock': '2118bc66', 'optr0': '2118bc66', 'optr1': '2118bc66'}
def pct(xs, q):
  xs = sorted(xs)
  if not xs: return None
  k = (len(xs) - 1) * q; f = int(k); c = min(f + 1, len(xs) - 1); return xs[f] + (xs[c] - xs[f]) * (k - f)
def stats(xs):
  xs = [x for x in xs if x is not None]
  return dict(n=len(xs), mean=round(st.mean(xs), 2) if xs else None, p50=round(pct(xs, .5), 2) if xs else None,
              p95=round(pct(xs, .95), 2) if xs else None, p99=round(pct(xs, .99), 2) if xs else None, sd=round(st.pstdev(xs), 2) if len(xs) > 1 else None)
def jl(paths):
  for p in paths:
    for l in open(p):
      l = l.strip()
      if l: yield json.loads(l)
def attempts(b): return max(b.get('atm_tx_attempts') or 0, b.get('atm_commit_attempts') or 0)
def reason_code(r):
  if not r: return 'none'
  if r.startswith('re-compose attempts exhausted'): return 're-compose-exhausted'
  if r.startswith('recovery-required:'): return 'recovery-required'
  if r.startswith('re-compose:'): return 're-compose(exhausted)'
  if 'canonical target base hash is stale' in r: return 'stale-precheck(unlocked)'
  if r.startswith('steward-final-patch-required'):
    if 'both edit region' in r: return 'steward-final-patch-required/same-region-in-batch'
    if 'changed after the proposal was anchored' in r: return 'steward-final-patch-required/region-changed'
    if 'cover the same lines' in r: return 'steward-final-patch-required/overlapping-rebase'
    if 'more than once' in r: return 'steward-final-patch-required/ambiguous-anchor'
    return 'steward-final-patch-required/declared-line-overlap'
  return r.split(':')[0][:40]
def classify(b):
  r = (b.get('blocked_reason') or ''); n = attempts(b)
  if b.get('steward_verdict') == 'applied': return 'applied_after_re-compose' if n >= 2 else 'applied'
  code = reason_code(r)
  if code in ('re-compose-exhausted', 'recovery-required', 're-compose(exhausted)'): return f'blocked:{code}'
  if n >= 1: return f'blocked:re-compose→{code}'
  return f'blocked:{code}'
def run_row(cell):
  d = os.path.join(RUNS, cell); meta = json.load(open(os.path.join(d, 'meta.json'))); m = ARM_RE.search(cell)
  arm = m.group(1) if m else None; res = RES.get(cell)
  art = os.path.join(d, 'atm', 'artifacts'); ev = os.path.join(d, 'atm', 'events')
  cb = sorted(glob.glob(os.path.join(art, 'compose_batches.w*.jsonl'))) or [os.path.join(ev, 'compose_batches.jsonl')]
  cb = [p for p in cb if os.path.exists(p)]
  batches = list(jl(cb)) if cb else []
  sa = sorted(glob.glob(os.path.join(art, 'steward_applies*.jsonl'))); applies = list(jl(sa)) if sa else []
  dec = [e for e in jl(sorted(glob.glob(os.path.join(ev, '*.jsonl')))) if e.get('event') == 'decision']
  bcls, icls, att_b, att_i = Counter(), Counter(), Counter(), Counter()
  for b in batches:
    c = classify(b); k = len(b.get('intent_ids') or b.get('proposalIds') or [])
    bcls[c] += 1; icls[c] += k; att_b[attempts(b)] += 1; att_i[attempts(b)] += k
  rc_events = sum(1 for b in batches if attempts(b) >= 2 or (attempts(b) >= 1 and b.get('steward_verdict') != 'applied'))
  rc_success = sum(1 for b in batches if attempts(b) >= 2 and b.get('steward_verdict') == 'applied')
  av = meta.get('atm_version') or ''
  pin = next((p for p in ('5692474f', 'bea35380', '2118bc66') if p in av), None)
  pols = {json.dumps(b.get('recompose_policy'), sort_keys=True) for b in batches}
  wall = (meta.get('modes', {}).get('atm') or {}).get('wall_clock_ms')
  fail = None
  if res: fail = bool(res['v2_fail'] or res['files_frame_violation'] or res['files_structure_violation'] or res['foreign_writes'] or res['extra_files'])
  return dict(cell=cell, arm=arm, pin=pin, pin_expected=PIN_OF.get(arm), policies=sorted(pols), procs=meta.get('procs') or (meta.get('params') or {}).get('procs'),
    seed=meta.get('workload_seed'), sched=meta.get('scheduler_seed'), scored=res is not None,
    offered=res['n_ops'] if res else None, correct=res['v2_correct'] if res else None, lost=res['v2_lost'] if res else None,
    v2_fail=res['v2_fail'] if res else None, by_verdict=res['v2_by_verdict'] if res else None,
    frame_files=res['files_frame_violation'] if res else None, structure_files=res['files_structure_violation'] if res else None,
    extra_files=res['extra_files'] if res else None, foreign_writes=res['foreign_writes'] if res else None, failed=fail,
    wall_ms=wall, batches=len(batches), batch_classes=dict(bcls), intent_classes=dict(icls),
    attempts_batches=dict(att_b), attempts_intents=dict(att_i), re_compose_events=rc_events, re_compose_success=rc_success,
    re_compose_extra_attempts=sum(max(attempts(b) - 1, 0) for b in batches),
    lock_contention_polls=sum((b.get('atm_commit_lock_contention_polls') or 0) for b in batches),
    sig_interleave=sum(1 for a in applies if a.get('interleave_suspect')), sig_drift=sum(1 for a in applies if a.get('post_write_drift')),
    total_ms=[e.get('total_ms') for e in dec], apply_ms=[e.get('apply_ms') for e in dec])
def blocked_of(ic): return sum(v for k, v in ic.items() if k.startswith('blocked'))
def agg(rows):
  rows = [r for r in rows if r['scored']]
  if not rows: return None
  s = lambda k: sum(r[k] or 0 for r in rows)
  ic, bc, ab, ai = Counter(), Counter(), Counter(), Counter()
  for r in rows: ic.update(r['intent_classes']); bc.update(r['batch_classes']); ab.update(r['attempts_batches']); ai.update(r['attempts_intents'])
  wall = [r['wall_ms'] for r in rows]
  blocked = blocked_of(ic)
  return dict(runs=len(rows), failed_runs=sum(1 for r in rows if r['failed']), lost_effects=s('lost'),
    corrupted_files=s('frame_files') + s('structure_files'), extra_files=sum(len(r['extra_files'] or []) for r in rows),
    foreign_writes=sum(len(r['foreign_writes'] or []) for r in rows), offered=s('offered'), correct=s('correct'), blocked_intents=blocked,
    identity_ok=(s('correct') + s('lost') + blocked == s('offered')), v2_fail_ops=s('v2_fail'),
    completion_rate=round(s('correct') / s('offered'), 4), mean_correct_per_run=round(s('correct') / len(rows), 2),
    wall_ms=stats(wall), re_compose_events=s('re_compose_events'), re_compose_success=s('re_compose_success'),
    re_compose_extra_attempts=s('re_compose_extra_attempts'), lock_contention_polls=s('lock_contention_polls'),
    sig_interleave=s('sig_interleave'), sig_drift=s('sig_drift'), batches=s('batches'), batch_classes=dict(bc), intent_classes=dict(ic),
    attempts_batches=dict(sorted(ab.items())), attempts_intents=dict(sorted(ai.items())),
    intent_total_ms=stats([x for r in rows for x in r['total_ms']]), intent_apply_ms=stats([x for r in rows for x in r['apply_ms']]))
cells = sorted(c for c in os.listdir(RUNS) if re.match(r'r4[vmr]-', c) and os.path.exists(os.path.join(RUNS, c, 'meta.json')))
rows = [run_row(c) for c in cells]
out = dict(definitions=__doc__, n_cells=len(rows), unscored=[r['cell'] for r in rows if not r['scored']],
           pin_mismatch=[r['cell'] for r in rows if r['arm'] and r['pin'] != r['pin_expected']])
rv = [r for r in rows if r['cell'].startswith('r4v-')]
exact = lambda r: re.match(r'r4v-e4-p2-s17-[a-z0-9]+-r\d+$', r['cell']) or re.match(r'r4v-e4-p2-s17-g-', r['cell'])
out['replay'] = {a: dict(all=agg([r for r in rv if r['arm'] == a]), p2_s17_35=agg([r for r in rv if r['arm'] == a and exact(r)]),
                         **{f'grid_p{p}': agg([r for r in rv if r['arm'] == a and '-g-' in r['cell'] and r['procs'] == p]) for p in (2, 4, 8)})
                 for a in ARMS}
# paired per-run comparison (descriptive only; NOT a significance test): same config/seed/rep, arms interleaved in time
def key_of(c): return ARM_RE.sub(lambda m: '-ARM' + (m.group(0)[len(m.group(1)) + 1:]), c)
byk = {}
for r in rv: byk.setdefault(key_of(r['cell']), {})[r['arm']] = r
def paired(a, b):
  ds = [byk[k][a]['correct'] - byk[k][b]['correct'] for k in byk if a in byk[k] and b in byk[k]]
  return dict(pairs=len(ds), higher=sum(d > 0 for d in ds), equal=sum(d == 0 for d in ds), lower=sum(d < 0 for d in ds),
              mean_diff_per_run=round(st.mean(ds), 2) if ds else None, sum_diff=sum(ds))
out['paired_completed'] = {f'{a}_vs_{b}': paired(a, b) for a, b in (('opt', 'fix'), ('opt', 'old'), ('fix', 'old'), ('optr0', 'opt'), ('optr1', 'opt'), ('optr0', 'fix'), ('optlock', 'opt'))}
out['replay_failures'] = [{k: r[k] for k in ('cell', 'arm', 'lost', 'v2_fail', 'frame_files', 'structure_files', 'extra_files', 'foreign_writes', 'by_verdict', 'sig_interleave', 'sig_drift')} for r in rv if r['failed']]
rm = [r for r in rows if r['cell'].startswith('r4m-')]
def mtype(c):
  return 'main_p2' if '-steward-p2-' in c else 'main_p4' if '-steward-p4-' in c else 'main_p8' if '-steward-p8-' in c else 'sp' if '-steward-sp-' in c else 'fault_naive_p8' if 'fault_naive' in c else 'fault_nolock_p8' if 'fault_nolock' in c else '?'
out['matrix'] = {a: {t: agg([r for r in rm if r['arm'] == a and mtype(r['cell']) == t]) for t in ('main_p2', 'main_p4', 'main_p8', 'sp', 'fault_naive_p8', 'fault_nolock_p8')} for a in ('old', 'fix', 'opt', 'optlock')}
out['matrix_all'] = {a: agg([r for r in rm if r['arm'] == a and mtype(r['cell']) != 'sp']) for a in ('old', 'fix', 'opt', 'optlock')}
out['matrix_failures'] = [{k: r[k] for k in ('cell', 'arm', 'lost', 'v2_fail', 'frame_files', 'structure_files', 'extra_files', 'by_verdict')} for r in rm if r['failed']]
rr = [r for r in rows if r['cell'].startswith('r4r-')]
reg = {}
for armname in ('steward', 'file_lock', 'occ', 'git_three_way', 'bare_composer'):
  for wl in ('hot_conflict', 'hot_disjoint', 'cold', 'ALL'):
    sel = lambda pin, rep=None: [r for r in rr if f'-{armname}-' in r['cell'] and (wl == 'ALL' or r['cell'].startswith(f'r4r-e2-{wl}-'))
                                 and r['arm'] == pin and (rep is None or f'-r{rep}-' in r['cell'])]
    o, f = agg(sel('fix')), agg(sel('opt'))
    if not o or not f: continue
    d = {}
    for k in ('intent_total_ms', 'intent_apply_ms', 'wall_ms'):
      d[k] = {q: (round(f[k][q] - o[k][q], 2), round((f[k][q] - o[k][q]) / o[k][q] * 100, 1) if o[k][q] else None) for q in ('mean', 'p50', 'p95')}
    noise = {}
    for pin in ('fix', 'opt'):
      a1, a2 = agg(sel(pin, 1)), agg(sel(pin, 2))
      if a1 and a2: noise[pin] = {k: {q: round(a2[k][q] - a1[k][q], 2) for q in ('mean', 'p50', 'p95')} for k in ('intent_total_ms', 'intent_apply_ms')}
    reg[f'{armname}/{wl}'] = dict(fix=o, opt=f, delta_opt_minus_fix=d, noise_rep2_minus_rep1=noise,
      correctness_same=(o['correct'], o['lost_effects'], o['failed_runs']) == (f['correct'], f['lost_effects'], f['failed_runs']))
out['regression'] = reg
out['barrier'] = {os.path.basename(p): json.load(open(os.path.join(p, 'barrier_result.json')))['summary']
                  for p in sorted(glob.glob(os.path.join(RUNS, 'r4-validation', 'barrier', '*')))}
fp = os.path.join(RUNS, 'r4-validation', 'faults', 'fault_results.json')
out['faults'] = json.load(open(fp))['summary'] if os.path.exists(fp) else None
json.dump(out, open(os.path.join(A.out, 'r4_summary.json'), 'w'), indent=1, ensure_ascii=False)
json.dump([{k: v for k, v in r.items() if k not in ('total_ms', 'apply_ms')} for r in rows], open(os.path.join(A.out, 'r4_cells.json'), 'w'), indent=1)
# ---------------- markdown
L = ['# r4 驗證表（ATM PR #214 merge 2118bc66 vs bea35380 vs 5692474f）', '',
     '> DRAFT。不主張勝出。作者自行執行、未獨立重現。由 `analysis/r4_compare.py` 從 raw 重建（唯讀）。定義見 r4_summary.json `definitions`。', '']
H = ('| 組 | 完成／總 intents | 失敗 runs／總 runs | 遺失效果 | blocked intents | 損壞檔 | 多餘檔 | re-compose 事件／成功 | 額外嘗試 | wall ms mean / p95 | intent total_ms mean / p95 |',
     '|---|---|---|---:|---:|---:|---:|---|---:|---|---|')
def row(name, g):
  if not g: return f'| {name} | – |'
  return (f"| {name} | {g['correct']}／{g['offered']}（{g['completion_rate']*100:.1f}%） | {g['failed_runs']}／{g['runs']} | {g['lost_effects']} | {g['blocked_intents']} | "
          f"{g['corrupted_files']} | {g['extra_files']} | {g['re_compose_events']}／{g['re_compose_success']} | {g['re_compose_extra_attempts']} | "
          f"{g['wall_ms']['mean']} / {g['wall_ms']['p95']} | {g['intent_total_ms']['mean']} / {g['intent_total_ms']['p95']} |")
L += ['## 1. E4 重播（r3 同配置：每臂 75 runs，含 p2/s17 共 35 次；三 pin 同時段交錯）', '', *H]
for a in ARMS:
  for sub in ('all', 'p2_s17_35', 'grid_p2', 'grid_p4', 'grid_p8'): L.append(row(f'{a} · {sub}', out['replay'][a][sub]))
L += ['', '臂：old＝5692474f；fix＝bea35380；opt＝2118bc66（主）；optlock＝2118bc66＋harness 鎖 on；optr0＝2118bc66＋maxRecomposeAttempts 0；optr1＝2118bc66＋maxRecomposeAttempts 1、backoff 0、jitter 0。除 optlock 外 harness 鎖皆 off。', '']
L += ['### 1-p. 逐 run 配對（同 seed／配置／rep；描述性，非顯著性檢定）', '', '| 比較 | 配對數 | 較高 | 相同 | 較低 | 每 run 平均差 | 合計差 |', '|---|---:|---:|---:|---:|---:|---:|']
for k, v in out['paired_completed'].items(): L.append(f"| {k} | {v['pairs']} | {v['higher']} | {v['equal']} | {v['lower']} | {v['mean_diff_per_run']} | {v['sum_diff']} |")
L += ['']
L += ['### 1a. blocked／完成 intents 依最終分類', '', '| 臂 | 分類 → intents |', '|---|---|']
for a in ARMS:
  ic = out['replay'][a]['all']['intent_classes'] if out['replay'][a]['all'] else {}
  L.append(f"| {a} | " + '; '.join(f'{k}: {v}' for k, v in sorted(ic.items())) + ' |')
L += ['', '### 1b. 每 batch 嘗試次數分布（batches；括號＝intents）', '', '| 臂 | 分布 |', '|---|---|']
for a in ARMS:
  g = out['replay'][a]['all']
  if g: L.append(f"| {a} | " + '; '.join(f"{k} 次: {v}（{g['attempts_intents'].get(k, 0)}）" for k, v in g['attempts_batches'].items()) + ' |')
L += ['', '## 2. E4 完整 cells（r1 同 seeds／flags）', '', *H]
for a in ('old', 'fix', 'opt', 'optlock'):
  for t, g in out['matrix'][a].items():
    if g: L.append(row(f'{a} · {t}', g))
L += ['', '## 3. 單 process 回歸（E2 子集：3 workloads × 5 arms × seeds 11/17/23 × 2 reps；bea35380→2118bc66）', '',
      '| arm/workload | 完成 fix→opt | lost fix/opt | failed runs fix/opt | total_ms mean fix→opt (Δ%) | p50 Δ | p95 Δ | apply_ms mean Δ (Δ%) | apply p95 Δ | 雜訊（同 pin rep2−rep1，total mean） |', '|---|---|---|---|---|---|---|---|---|---|']
for k, v in reg.items():
  o, f, d = v['fix'], v['opt'], v['delta_opt_minus_fix']; n = v['noise_rep2_minus_rep1']
  L.append(f"| {k} | {o['correct']}/{o['offered']} → {f['correct']}/{f['offered']} | {o['lost_effects']}/{f['lost_effects']} | {o['failed_runs']}/{f['failed_runs']} | "
           f"{o['intent_total_ms']['mean']} → {f['intent_total_ms']['mean']} ({d['intent_total_ms']['mean'][1]}%) | {d['intent_total_ms']['p50'][0]} | {d['intent_total_ms']['p95'][0]} | "
           f"{d['intent_apply_ms']['mean'][0]} ({d['intent_apply_ms']['mean'][1]}%) | {d['intent_apply_ms']['p95'][0]} | fix {n.get('fix', {}).get('intent_total_ms', {}).get('mean')} / opt {n.get('opt', {}).get('intent_total_ms', {}).get('mean')} |")
L += ['', '## 4. Barrier 2-process 交錯測試（確定性）', '', '| 案例 | window hit | 遺失效果 | follower 結果 | 最終＝leader-only | 最終＝兩者 full bytes | 殘留檔 | follower lock 取得／tx 嘗試 |', '|---|---|---|---|---|---|---|---|']
for k, b in out['barrier'].items():
  L.append(f"| {k} | {b['window_hit']}/{b['reps']} | {b['lost_effects_total']} | {b['follower_classes']} | {b['final_equals_leader_only']} | {b.get('final_equals_both_full_bytes')} | {b['leftover_files']} | {b['follower_commit_guard_attempts']}／{b.get('follower_tx_attempts')} |")
if out['faults']:
  L += ['', '## 5. 故障情境（harness 層；2118bc66 主、bea35380 對照）', '', '| 情境 | variant | pin | n | 遺失效果（runs） | frame 壞 | 殘留檔 | 結果分布 |', '|---|---|---|---:|---|---:|---:|---|']
  for k, g in out['faults'].items():
    sc, var, pin = [x.strip() for x in k.split('|')]
    L.append(f"| {sc} | {var} | {pin} | {g['n']} | {g['lost_effects']}（{g['runs_with_lost']}） | {g['frame_bad']} | {g['leftovers']} | {g['outcomes']} |")
open(os.path.join(A.out, 'R4_TABLES.md'), 'w').write('\n'.join(L) + '\n')
print(json.dumps({a: {k: out['replay'][a]['all'][k] for k in ('runs', 'failed_runs', 'lost_effects', 'corrupted_files', 'correct', 'blocked_intents', 'identity_ok', 're_compose_events', 're_compose_success')} for a in ARMS if out['replay'][a]['all']}, indent=0))
print('pin_mismatch', out['pin_mismatch'], 'unscored', len(out['unscored']))
