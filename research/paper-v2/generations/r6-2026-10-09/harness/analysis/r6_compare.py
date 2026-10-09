#!/usr/bin/env python3
"""r6 analysis-only comparison (derived from analysis/r5_compare.py; r5 file unchanged; same definitions/metrics). Adds: SQLITE busy/locked exception
count per arm, leaked queue presence files per run, stress repro and r6 fault/barrier summaries.
(r5 docstring follows) r5 analysis-only comparison (derived from analysis/r4_compare.py; r4 file unchanged) (READ-ONLY on runs/*; writes only to --out).
Inputs: oracle v2 artifact-only rescore (rescore_cells.json), per-run meta/compose_batches/steward_applies/events,
runs/r5-validation/barrier/*/barrier_result.json, runs/r5-validation/faults/*/fault_results.json, runs/r5-validation/e5/*.out.
Outputs: r5_summary.json + r5_cells.json + R5_TABLES.md.
Definitions (same as r3 unless noted):
  completed intent = ATM `applied` and oracle v2 finds the effect in the final bytes (v2 'correct').
  lost effect      = v2 verdict 'lost' (ATM acked `applied`, effect absent from final bytes). Counted per effect, not per failure.
  blocked intent   = intent whose batch ended `blocked` (incl. after re-compose); completed + lost + blocked = total intents.
  failed run       = any op with a failing v2 verdict, or any file frame/structure violation, foreign write or extra file.
  corrupted file   = file with frame or structure violation (incl. torn tails).
  attempts (r5)    = per batch max(atm_tx_attempts, atm_commit_attempts, atm_commit_owner_writes); owner writes = lock acquisitions at
                     every guarded pin (37847584 creates the lock dir recursively, so atm_commit_attempts stays 0 there).
  Wilson 95% CI    = score interval (z=1.96) on intents (completed/total, lost/total) and on runs (failed/total). Intents within a run
                     are not independent, so intent-level intervals are optimistic (too narrow); reported as descriptive only.
  (r4 text) attempts = per batch max(atm_tx_attempts, atm_commit_attempts). atm_tx_attempts counts ATM's forwarded
                     commitHooks.beforePrecheck calls (2118bc66+ only; = transactional apply attempts, incl. those that end at
                     the unlocked early stale check); atm_commit_attempts counts commit-lock acquisitions (bea35380+). 5692474f: 0.
  re-compose event = batch with attempts>=2, or attempts>=1 and final `blocked` (the first attempt returned re-compose).
  re-compose success = batch `applied` with attempts>=2.
  percentiles      = linear interpolation (numpy 'linear'); mean±sd is NOT a CI.
"""
import argparse, glob, json, math, os, re, statistics as st
from collections import Counter
ap = argparse.ArgumentParser(); ap.add_argument('--rescore', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--runs', default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'runs'))
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True); RUNS = A.runs
RES = {r['cell']: r for r in json.load(open(A.rescore))['rows'] if r['mode'] == 'atm'}
ARMS = ('q5', 'q6', 'nq6')
ARM_RE = re.compile(r'-(q5|q6|nq6)(?:-r\d+)?$')
PIN_OF = {'q5': '37847584', 'q6': 'b35a6141', 'nq6': 'b35a6141'}
ENV_OF = {'q5': {'ATM_STEWARD_APPLY_QUEUE': 'on'}, 'q6': {'ATM_STEWARD_APPLY_QUEUE': 'on'}, 'nq6': {'ATM_STEWARD_APPLY_QUEUE': 'off'}}
def wilson(k, n, z=1.96):
  if not n: return None
  p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return [round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]
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
def attempts(b): return max(b.get('atm_tx_attempts') or 0, b.get('atm_commit_attempts') or 0, b.get('atm_commit_owner_writes') or 0)
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
SQ_RE = re.compile(r'SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked|ERR_SQLITE', re.I)
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
  pin = next((p for p in ('5692474f', 'bea35380', '2118bc66', '37847584', 'b35a6141') if p in av), None)
  pols = {json.dumps(b.get('recompose_policy'), sort_keys=True) for b in batches}
  envs = {json.dumps(b.get('atm_env') or {}, sort_keys=True) for b in batches if 'atm_env' in b}  # v2 (DEVIATIONS.md D2)
  wall = (meta.get('modes', {}).get('atm') or {}).get('wall_clock_ms')
  fail = None
  if res: fail = bool(res['v2_fail'] or res['files_frame_violation'] or res['files_structure_violation'] or res['foreign_writes'] or res['extra_files'])
  sq_b = [b for b in batches if SQ_RE.search(' '.join([str(b.get('blocked_reason') or '')] + [str(x) for x in (b.get('blocked_reasons') or [])]))]
  qroot = os.path.join(d, 'atm', 'worktree', '.atm', 'runtime', 'broker-steward-apply-queue')
  presence = sorted(os.path.relpath(p, d) for p in glob.glob(os.path.join(qroot, '*', 'p', '*')) if os.path.isfile(p))
  so = os.path.join(RUNS, 'r6-validation', 'stdout', cell + '.log'); so_hits = 0
  if os.path.exists(so): so_hits = len(SQ_RE.findall(open(so, errors='replace').read()))
  return dict(sqlite_exc_batches=len(sq_b), sqlite_exc_intents=sum(len(b.get('intent_ids') or []) for b in sq_b), presence_left=presence, stdout_sqlite_mentions=so_hits,
    cell=cell, arm=arm, pin=pin, pin_expected=PIN_OF.get(arm), policies=sorted(pols), atm_envs=sorted(envs), env_ok=(envs <= {json.dumps(ENV_OF.get(arm, {}), sort_keys=True)}) if arm else None, procs=meta.get('procs') or (meta.get('params') or {}).get('procs'),
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
    wilson_completed=wilson(s('correct'), s('offered')), wilson_failed_runs=wilson(sum(1 for r in rows if r['failed']), len(rows)), wilson_lost=wilson(s('lost'), s('offered')),
    hash_drift_intents=sum(v for k, v in ic.items() if 'file-hash-drift' in k),
    exception_blocked_intents=sum(v for k, v in ic.items() if re.match(r'blocked:(ERR_|steward_exception)', k)),
    wall_ms=stats(wall), re_compose_events=s('re_compose_events'), re_compose_success=s('re_compose_success'),
    re_compose_extra_attempts=s('re_compose_extra_attempts'), lock_contention_polls=s('lock_contention_polls'),
    sig_interleave=s('sig_interleave'), sig_drift=s('sig_drift'), batches=s('batches'), batch_classes=dict(bc), intent_classes=dict(ic),
    attempts_batches=dict(sorted(ab.items())), attempts_intents=dict(sorted(ai.items())),
    sqlite_exc_intents=s('sqlite_exc_intents'), sqlite_exc_runs=sum(1 for r in rows if r['sqlite_exc_batches']), presence_left_files=sum(len(r['presence_left']) for r in rows), presence_left_runs=sum(1 for r in rows if r['presence_left']), stdout_sqlite_mentions=s('stdout_sqlite_mentions'),
    intent_total_ms=stats([x for r in rows for x in r['total_ms']]), intent_apply_ms=stats([x for r in rows for x in r['apply_ms']]))
cells = sorted(c for c in os.listdir(RUNS) if re.match(r'r6[vm]-', c) and os.path.exists(os.path.join(RUNS, c, 'meta.json')))
rows = [run_row(c) for c in cells]
out = dict(definitions=__doc__, n_cells=len(rows), unscored=[r['cell'] for r in rows if not r['scored']],
           pin_mismatch=[r['cell'] for r in rows if r['arm'] and r['pin'] != r['pin_expected']],
           env_mismatch=[r['cell'] for r in rows if r['arm'] and r['batches'] and not r['env_ok']])
rv = [r for r in rows if r['cell'].startswith('r6v-')]
def rep(r): return int(re.search(r'-r(\d+)$', r['cell']).group(1))
def block(r): return 1 if (rep(r) <= 30 if '-g-' not in r['cell'] else rep(r) <= 5) else 2
out['replay'] = {a: dict(all=agg([r for r in rv if r['arm'] == a]), block1=agg([r for r in rv if r['arm'] == a and block(r) == 1]), block2=agg([r for r in rv if r['arm'] == a and block(r) == 2]),
                         p2_s17_exact=agg([r for r in rv if r['arm'] == a and '-g-' not in r['cell']]),
                         **{f'grid_p{p}': agg([r for r in rv if r['arm'] == a and '-g-' in r['cell'] and r['procs'] == p]) for p in (2, 4, 8)})
                 for a in ARMS}
def key_of(c): return ARM_RE.sub(lambda m: '-ARM' + (m.group(0)[len(m.group(1)) + 1:]), c)
byk = {}
for r in rv: byk.setdefault(key_of(r['cell']), {})[r['arm']] = r
def paired(a, b):
  ds = [byk[k][a]['correct'] - byk[k][b]['correct'] for k in byk if a in byk[k] and b in byk[k] and byk[k][a]['scored'] and byk[k][b]['scored']]
  return dict(pairs=len(ds), higher=sum(d > 0 for d in ds), equal=sum(d == 0 for d in ds), lower=sum(d < 0 for d in ds),
              mean_diff_per_run=round(st.mean(ds), 2) if ds else None, sum_diff=sum(ds))
out['paired_completed'] = {f'{a}_vs_{b}': paired(a, b) for a, b in (('q6', 'q5'), ('nq6', 'q6'), ('nq6', 'q5'))}
out['replay_failures'] = [{k: r[k] for k in ('cell', 'arm', 'lost', 'v2_fail', 'frame_files', 'structure_files', 'extra_files', 'foreign_writes', 'by_verdict', 'sig_interleave', 'sig_drift')} for r in rv if r['failed']]
rm = [r for r in rows if r['cell'].startswith('r6m-')]
out['matrix'] = {a: agg([r for r in rm if r['arm'] == a]) for a in ARMS}
out['matrix_failures'] = [{k: r[k] for k in ('cell', 'arm', 'lost', 'v2_fail', 'frame_files', 'structure_files', 'extra_files', 'by_verdict')} for r in rm if r['failed']]
exc_rows = [(r['cell'], k, v) for r in rows for k, v in r['intent_classes'].items() if re.match(r'blocked:(ERR_|steward_exception)', k)]
out['exception_blocked'] = dict(n_intents=sum(v for _, _, v in exc_rows), n_runs=len({c for c, _, _ in exc_rows}), by_arm=dict(Counter(ARM_RE.search(c).group(1) for c, _, v in exc_rows for _ in range(v))), cells=[dict(cell=c, cls=k, intents=v) for c, k, v in exc_rows])
out['sqlite_and_presence'] = {a: dict(runs=sum(1 for r in rows if r['arm'] == a), sqlite_exc_intents=sum(r['sqlite_exc_intents'] for r in rows if r['arm'] == a), sqlite_exc_runs=sum(1 for r in rows if r['arm'] == a and r['sqlite_exc_batches']),
                                      presence_left_files=sum(len(r['presence_left']) for r in rows if r['arm'] == a), presence_left_runs=sum(1 for r in rows if r['arm'] == a and r['presence_left']),
                                      stdout_sqlite_mentions=sum(r['stdout_sqlite_mentions'] for r in rows if r['arm'] == a)) for a in ARMS}
out['presence_cells'] = [dict(cell=r['cell'], files=r['presence_left']) for r in rows if r['presence_left']]
SB = os.path.join(RUNS, 'r6-validation', 'forensics', 'sqlite-busy')
def stress_of(summary, fname):
  if not os.path.exists(os.path.join(SB, summary)): return {}
  res = {}
  for x in jl([os.path.join(SB, summary)]):
    g = res.setdefault(x['pin'], dict(rounds=0, procs=0, calls_ok=0, calls_threw=0, presence_files_left=0, errs=Counter()))
    g['rounds'] += 1; g['presence_files_left'] += x['presence_files_left']
    for j in jl([os.path.join(SB, fname.format(pin=x['pin'], round=x['round']))]):
      g['procs'] += 1; g['calls_ok'] += j['ok']; g['calls_threw'] += sum(j['errs'].values()); g['errs'].update(j['errs'])
  return {k: dict(v, errs=dict(v['errs'])) for k, v in res.items()}
out['stress'] = stress_of('stress-summary.jsonl', 'stress-{pin}-round{round}.jsonl')
out['stress_posthoc_16x1000'] = stress_of('posthoc-stress-summary.jsonl', 'posthoc-stress16x1000-{pin}-round{round}.jsonl')  # post-hoc, exploratory (DEVIATIONS)
out['barrier'] = {os.path.basename(p): json.load(open(os.path.join(p, 'barrier_result.json')))['summary'] for p in sorted(glob.glob(os.path.join(RUNS, 'r6-validation', 'barrier', '*')))}
out['faults'] = {}; out['fault_checks'] = {}
for fp in sorted(glob.glob(os.path.join(RUNS, 'r6-validation', 'faults', '*', 'fault_results.json'))):
  fr = json.load(open(fp)); out['faults'].update(fr['summary'])
  for x in fr['runs']:
    k = f"{x['scenario']} | {x['variant']} | {x['pin']}"; c = out['fault_checks'].setdefault(k, Counter())
    if 'ns_split_confirmed' in x and x['ns_split_confirmed'] is not None: c['ns_split_confirmed'] += bool(x['ns_split_confirmed']); c['ns_checked'] += 1
    if x['scenario'].startswith('F6'): c['both_inside_lock'] += bool(x.get('both_inside_lock'))
    if 'live_temp_survived_cleaner' in x: c['live_temp_survived_cleaner'] += bool(x['live_temp_survived_cleaner']); c['cleaner_skipped_live_holder'] += bool((x.get('C') or {}).get('cleanup', {}) and x['C']['cleanup'].get('skippedLiveHolder'))
    if x.get('live_temp_survived_B') is not None: c['live_temp_survived_B'] += bool(x['live_temp_survived_B']); c['live_temp_B_checked'] += 1
    rmv = ((x.get('B') or {}).get('rm_foreign_temps') or [])
    if rmv: c['orphan_removed_by_B'] += 1; c['orphan_removed_after_lock'] += all(e['owner_writes_so_far'] >= 1 for e in rmv)
    if x['scenario'].startswith('F1'): c['orphan_after_kill'] += bool([n for n in (x.get('leftover_after_kill') or []) if n.endswith('.atm-tmp')])
  out['fault_meta_' + os.path.basename(os.path.dirname(fp))] = {k: fr.get(k) for k in ('test', 'node', 'host_pidns', 'unshare', 'pins', 'reps')}
out['fault_checks'] = {k: dict(v) for k, v in out['fault_checks'].items()}
out['counterexamples'] = dict(replay_lost=sum((out['replay'][a]['all'] or {}).get('lost_effects', 0) for a in ARMS), replay_corrupted=sum((out['replay'][a]['all'] or {}).get('corrupted_files', 0) for a in ARMS),
  matrix_lost=sum((out['matrix'][a] or {}).get('lost_effects', 0) for a in ARMS), matrix_corrupted=sum((out['matrix'][a] or {}).get('corrupted_files', 0) for a in ARMS),
  faults_lost=sum(g['lost_effects'] for g in out['faults'].values()), faults_frame_bad=sum(g['frame_bad'] for g in out['faults'].values()),
  barrier_lost=sum(b.get('lost_effects_total') or 0 for b in out['barrier'].values()))
json.dump(out, open(os.path.join(A.out, 'r6_summary.json'), 'w'), indent=1, ensure_ascii=False)
json.dump([{k: v for k, v in r.items() if k not in ('total_ms', 'apply_ms')} for r in rows], open(os.path.join(A.out, 'r6_cells.json'), 'w'), indent=1)
L = ['# r6 驗證表（ATM b35a6141＝PR #238 queue on／off vs 37847584 queue on；同時段交錯）', '',
     '> DRAFT。不主張勝出。作者自行執行、未獨立重現。由 `analysis/r6_compare.py` 從 raw 重建（唯讀）。定義同 r5（見 r6_summary.json `definitions`）。Wilson 95% CI 為描述性（intent 非獨立）。預先登錄：`runs/r6-validation/PREREG_R6.md`。', '']
H = ('| 組 | 完成／總 intents | 完成 Wilson 95% | 失敗 runs／總 runs | 失敗 runs Wilson 95% | 遺失效果 | 遺失 Wilson 95%（per intent） | blocked intents | 其中 hash-drift | 其中 ATM 例外 | SQLITE busy/locked intents（runs） | 殘留 presence 檔（runs） | 損壞檔 | 多餘檔 | re-compose 事件／成功 | wall ms mean / p95 | intent total_ms mean / p95 |',
     '|---|---|---|---|---|---:|---|---:|---:|---:|---|---|---:|---:|---|---|---|')
def row(name, g):
  if not g: return f'| {name} | – |'
  return (f"| {name} | {g['correct']}／{g['offered']}（{g['completion_rate']*100:.1f}%） | {g['wilson_completed']} | {g['failed_runs']}／{g['runs']} | {g['wilson_failed_runs']} | {g['lost_effects']} | {g['wilson_lost']} | {g['blocked_intents']} | {g['hash_drift_intents']} | {g['exception_blocked_intents']} | "
          f"{g['sqlite_exc_intents']}（{g['sqlite_exc_runs']}） | {g['presence_left_files']}（{g['presence_left_runs']}） | {g['corrupted_files']} | {g['extra_files']} | {g['re_compose_events']}／{g['re_compose_success']} | "
          f"{g['wall_ms']['mean']} / {g['wall_ms']['p95']} | {g['intent_total_ms']['mean']} / {g['intent_total_ms']['p95']} |")
L += ['## 1. E4 重播（r5 同配置與 seeds；每臂 2 blocks × 75 runs）', '', *H]
for a in ARMS:
  for sub in ('all', 'block1', 'block2', 'p2_s17_exact', 'grid_p2', 'grid_p4', 'grid_p8'): L.append(row(f'{a} · {sub}', out['replay'][a][sub]))
L += ['', '臂：q5＝37847584 queue on（r5 主臂同時段重跑）；q6＝b35a6141 queue on（r6 主，ATM 預設）；nq6＝b35a6141 queue off。harness 鎖皆 off。block1＝r5 原 75 runs 編號；block2＝同配置續編 reps。', '']
L += ['### 1-p. 逐 run 配對（描述性，非顯著性檢定）', '', '| 比較 | 配對數 | 較高 | 相同 | 較低 | 每 run 平均差 | 合計差 |', '|---|---:|---:|---:|---:|---:|---:|']
for k, v in out['paired_completed'].items(): L.append(f"| {k} | {v['pairs']} | {v['higher']} | {v['equal']} | {v['lower']} | {v['mean_diff_per_run']} | {v['sum_diff']} |")
L += ['', '## 2. E4 主 cells（p{2,4,8} × s{11,17,23}；multi-process）', '', *H]
for a in ARMS: L.append(row(f'{a} · matrix', out['matrix'][a]))
L += ['', '## 3. SQLITE busy/locked 例外與 presence 殘留（replay＋matrix 全部 runs）', '', '| 臂 | runs | SQLITE 例外 intents | 受影響 runs | 殘留 presence 檔 | 有殘留的 runs | stdout 提及 SQLITE 次數 |', '|---|---:|---:|---:|---:|---:|---:|']
for a, g in out['sqlite_and_presence'].items(): L.append(f"| {a} | {g['runs']} | {g['sqlite_exc_intents']} | {g['sqlite_exc_runs']} | {g['presence_left_files']} | {g['presence_left_runs']} | {g['stdout_sqlite_mentions']} |")
L += ['', f"ATM 例外 blocked 合計：{out['exception_blocked']['n_intents']} intents／{out['exception_blocked']['n_runs']} runs；依臂 {out['exception_blocked']['by_arm']}", '']
if out['exception_blocked']['cells']:
  L += ['| run | 分類 | intents |', '|---|---|---:|'] + [f"| {e['cell']} | {e['cls']} | {e['intents']} |" for e in out['exception_blocked']['cells']] + ['']
L += ['### 3a. queue stress repro（r5 forensics 腳本原樣；8 processes × 300 calls × 3 rounds／pin）', '', '| pin | rounds | procs | 成功 calls | 拋出 calls | 殘留 presence 檔 | 錯誤分布 |', '|---|---:|---:|---:|---:|---:|---|']
for k, g in out['stress'].items(): L.append(f"| {k} | {g['rounds']} | {g['procs']} | {g['calls_ok']} | {g['calls_threw']} | {g['presence_files_left']} | {g['errs']} |")
L += ['', '### 3b. † 事後加重 stress（非預先登錄、探索性；同腳本，16 processes × 1,000 calls × 3 rounds／pin，交錯）', '', '| pin | rounds | procs | 成功 calls | 拋出 calls | 殘留 presence 檔 | 錯誤分布 |', '|---|---:|---:|---:|---:|---:|---|']
for k, g in out['stress_posthoc_16x1000'].items(): L.append(f"| {k} | {g['rounds']} | {g['procs']} | {g['calls_ok']} | {g['calls_threw']} | {g['presence_files_left']} | {g['errs']} |")
L += ['', '### 1a. blocked／完成 intents 依最終分類', '', '| 臂 | 分類 → intents |', '|---|---|']
for a in ARMS:
  ic = out['replay'][a]['all']['intent_classes'] if out['replay'][a]['all'] else {}
  L.append(f"| {a} | " + '; '.join(f'{k}: {v}' for k, v in sorted(ic.items())) + ' |')
L += ['', '## 4. 故障情境（harness 層；b35a6141 queue on／off）', '', '| 情境 | variant | pin | n | 遺失效果（runs） | frame 壞 | 殘留檔 | 結果分布 |', '|---|---|---|---:|---|---:|---:|---|']
for k, g in out['faults'].items():
  sc, var, pin = [x.strip() for x in k.split('|')]
  L.append(f"| {sc} | {var} | {pin} | {g['n']} | {g['lost_effects']}（{g['runs_with_lost']}） | {g['frame_bad']} | {g['leftovers']} | {g['outcomes']} |")
L += ['', '### 4a. 證明欄位（namespace 分離、孤兒清理時機、存活寫入者的 temp）', '', '| 情境 | 檢查 |', '|---|---|']
for k, c in out['fault_checks'].items():
  if c: L.append(f"| {k} | {c} |")
L += ['', '## 5. Barrier 2-process 交錯（確定性；b35a6141）', '', '| 案例 | window hit | 遺失效果 | follower 結果 | 最終＝leader-only | 最終＝兩者 full bytes | 殘留檔 |', '|---|---|---|---|---|---|---|']
for k, b in out['barrier'].items():
  L.append(f"| {k} | {b['window_hit']}/{b['reps']} | {b['lost_effects_total']} | {b['follower_classes']} | {b['final_equals_leader_only']} | {b.get('final_equals_both_full_bytes')} | {b['leftover_files']} |")
L += ['', '## 6. 反例檢查（§5.7：任何遺失效果或損壞檔）', '', f"{out['counterexamples']}", '']
open(os.path.join(A.out, 'R6_TABLES.md'), 'w').write('\n'.join(L) + '\n')
print(json.dumps({a: {k: out['replay'][a]['all'][k] for k in ('runs', 'failed_runs', 'lost_effects', 'corrupted_files', 'correct', 'offered', 'blocked_intents', 'identity_ok', 'sqlite_exc_intents', 'presence_left_files')} for a in ARMS if out['replay'][a]['all']}, indent=0))
print('pin_mismatch', out['pin_mismatch'], 'env_mismatch', out['env_mismatch'], 'unscored', len(out['unscored']), 'counterexamples', out['counterexamples'])
