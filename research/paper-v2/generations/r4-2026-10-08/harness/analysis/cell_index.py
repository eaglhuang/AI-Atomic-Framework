#!/usr/bin/env python3
"""r2 Phase 1 C/D: per-cell provenance index (read-only on runs/). One row per paper-relevant cell (r1 + r2 + r3 + r4)."""
import json, os, re, sys, hashlib, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS = os.path.join(ROOT, 'runs')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RUNS, 'r2-analysis', 'cell-index')
os.makedirs(OUT, exist_ok=True)
def archive(c):
    for pat, a in [(r'^e1-', 'r1:raw/e1.tgz'), (r'^e2-', 'r1:raw/e2.tgz'), (r'^e3-', 'r1:raw/e3.tgz'), (r'^e4-', 'r1:raw/e4.tgz'),
                   (r'^e5-', 'r1:raw/e5.tgz'), (r'^c4-', 'r1:raw/c.tgz'), (r'^d[1-5]-', 'r1:raw/d.tgz'), (r'^steward-', 'r1:raw/steward.tgz'),
                   (r'^gaps-', 'r1:raw/gaps.tgz'), (r'^(composer-probe|b5-b8)$', 'r1:raw/b-probes.tgz'), (r'^r2f-', 'r2:raw/r2-e4-forensics.tgz'),
                   (r'^r2-smoke-', 'r2:raw/r2-smoke.tgz'), (r'^r3v-', 'r3:raw/r3-replay.tgz'), (r'^r3m-', 'r3:raw/r3-matrix.tgz'),
                   (r'^r3r-', 'r3:raw/r3-regression.tgz'), (r'^(r3s-|r3-smoke-)', 'r3:raw/r3-sp-noise-and-smoke.tgz'),
                   (r'^r4v-.*-(old|fix|opt)-r\d+$', 'r4:raw/r4-replay-pins.tgz'), (r'^r4v-.*-(optlock|optr0|optr1)-r\d+$', 'r4:raw/r4-replay-secondary-ablation.tgz'), (r'^r4m-', 'r4:raw/r4-matrix.tgz'), (r'^r4r-', 'r4:raw/r4-regression.tgz')]:
        if re.match(pat, c): return a
    return None
SKIP = {'e1-pilot', 'e2-matrix', 'e3-sweep', 'e4-multiprocess', 'e5-fault', 'steward-writer'}
rows = []
for c in sorted(os.listdir(RUNS)):
    d = os.path.join(RUNS, c)
    a = archive(c)
    if not a or c in SKIP or not os.path.isdir(d): continue
    m = json.load(open(os.path.join(d, 'meta.json'))) if os.path.exists(os.path.join(d, 'meta.json')) else {}
    params = m.get('params') or {}
    av = m.get('atm_version') or ''
    pin = re.search(r'([0-9a-f]{40})', av)
    mode = 'atm' if os.path.isdir(os.path.join(d, 'atm')) else ('control' if os.path.isdir(os.path.join(d, 'control')) else None)
    art = os.path.join(d, mode, 'artifacts') if mode else None
    v1 = json.load(open(os.path.join(art, 'oracle_summary.json')))['summary'].get('oracle_version') if art and os.path.exists(os.path.join(art, 'oracle_summary.json')) else None
    v2rt = 'c4-fullbytes-frame-v2' if art and os.path.exists(os.path.join(art, 'oracle_v2_summary.json')) else None
    ev = sorted(os.path.relpath(p, d) for p in glob.glob(os.path.join(d, mode or 'x', 'events', '*.jsonl'))) if mode else []
    rows.append(dict(run_id=c, raw_archive=a, mode=mode, arm=m.get('arm') or params.get('arm'), arm_role=m.get('arm_role'),
        process_model=m.get('process_model', 'single-process' if m else None), procs=m.get('procs'),
        workload_seed=m.get('workload_seed', m.get('scenario_seed')), scheduler_seed=m.get('scheduler_seed'),
        scenario_hash=m.get('scenario_hash'), fixture_commit=m.get('fixture_commit'),
        params_sha256=hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest() if params else None,
        atm_pin=pin.group(1) if pin else None, atm_version=av or None, cli_version=m.get('cli_version'), node_version=m.get('node_version'),
        mp_ablation=m.get('mp_ablation'), oracle_runtime_v1=v1, oracle_runtime_v2=v2rt, oracle_v2_rescored=bool(v1),
        harness_src=('r2 (pre runtime-oracle-v2 hook)' if c.startswith('r2f-') else 'r2' if c.startswith('r2-smoke-') else
                     'r3 (r3 harness: runtime oracle v2 + commit-guard observer; see generations/r3 harness/)' if re.match(r'^(r3[vmrs]-|r3-smoke-)', c) else
                     'r4 (r4 harness: + tx-attempt counter via commitHooks.beforePrecheck, generalized lock observer, optional recomposePolicy env; see generations/r4 harness/)' if re.match(r'^r4[vmr]-', c) else
                     'r1-era (per-run harness source hash NOT recorded in r1; src was edited between stages)'),
        n_event_files=len(ev), created_at=m.get('created_at')))
json.dump(dict(n=len(rows), cells=rows), open(os.path.join(OUT, 'CELL_INDEX.json'), 'w'), indent=1)
keys = ['run_id', 'raw_archive', 'arm', 'arm_role', 'procs', 'workload_seed', 'scheduler_seed', 'scenario_hash', 'fixture_commit', 'params_sha256', 'atm_pin', 'oracle_runtime_v1', 'oracle_runtime_v2', 'harness_src', 'created_at']
with open(os.path.join(OUT, 'CELL_INDEX.csv'), 'w') as f:
    f.write(','.join(keys) + '\n')
    for r in rows: f.write(','.join('"' + str(r.get(k) if r.get(k) is not None else '').replace('"', "'") + '"' for k in keys) + '\n')
from collections import Counter
print(len(rows), Counter(r['raw_archive'] for r in rows), Counter(r['atm_pin'] for r in rows))
