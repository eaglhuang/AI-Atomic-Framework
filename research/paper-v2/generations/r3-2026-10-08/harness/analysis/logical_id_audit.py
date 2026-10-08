#!/usr/bin/env python3
"""r2: audit the E1/E2 logical_id==intent_id stub from raw events (read-only). Salvageable iff every pre-registered intent
has exactly one submit, one terminal decision, attempt count 1 (no retry/re-propose), and at most one correct effect."""
import json, os, glob, sys, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); RUNS = os.path.join(ROOT, 'runs')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RUNS, 'r2-analysis', 'logical-id-audit'); os.makedirs(OUT, exist_ok=True)
res = []
for d in sorted(glob.glob(os.path.join(RUNS, 'e[12]-*'))):
    c = os.path.basename(d)
    if c in ('e1-pilot', 'e2-matrix'): continue
    mode = 'atm' if os.path.isdir(os.path.join(d, 'atm')) else 'control'
    ee = os.path.join(d, mode, 'scenarios', 'expected_effects.json')
    if not os.path.exists(ee): continue
    eff = json.load(open(ee))['effects']
    sub, dec, rep = collections.Counter(), collections.Counter(), collections.Counter()
    for f in glob.glob(os.path.join(d, mode, 'events', '*.jsonl')):
        for l in open(f):
            e = json.loads(l)
            if e.get('event') == 'submit': sub[e['intent_id']] += 1
            elif e.get('event') == 'decision':
                dec[e['intent_id']] += 1
                rep[e['intent_id']] += int(e.get('repropose_rounds') or 0)
    orr = [json.loads(l) for l in open(os.path.join(d, mode, 'artifacts', 'oracle_results.jsonl'))]
    corr = collections.Counter(r['intent_id'] for r in orr if r['oracle_verdict'] == 'correct')
    ids = [e['intent_id'] for e in eff]
    stub = all((e.get('logical_id') or e['intent_id']) == e['intent_id'] for e in eff)
    bad = [i for i in ids if sub[i] != 1 or dec[i] != 1 or corr[i] > 1]
    multi = [i for i in ids if rep[i] > 0]
    res.append(dict(cell=c, offered=len(ids), unique_intents=len(set(ids)), logical_id_stub=stub, violations=len(bad), sample=bad[:3],
        multi_attempt_ops=len(multi), extra_attempts=sum(rep[i] for i in ids)))
ok = sum(r['violations'] == 0 and r['offered'] == r['unique_intents'] for r in res)
summ = dict(cells=len(res), cells_ok=ok, cells_with_stub=sum(r['logical_id_stub'] for r in res),
    cells_with_multi_attempt_ops=sum(r['multi_attempt_ops'] > 0 for r in res), multi_attempt_ops=sum(r['multi_attempt_ops'] for r in res),
    extra_attempts=sum(r['extra_attempts'] for r in res),
    verdict='salvageable: each intent = one logical op (1 submit, 1 terminal, <=1 correct effect); offered denominator fixed' if ok == len(res) else 'NOT fully salvageable — see violations')
json.dump(dict(summary=summ, cells=res), open(os.path.join(OUT, 'logical_id_audit.json'), 'w'), indent=1)
open(os.path.join(OUT, 'LOGICAL_ID_AUDIT.md'), 'w').write(f"# E1/E2 logical_id stub audit（r2）\n\n{json.dumps(summ, ensure_ascii=False)}\n\n條件：每個預登記 intent 恰 1 個 submit、1 個 terminal decision、correct≤1；offered＝唯一 intent 數。多 attempt（OCC／git 的 CAS retry，記在 repropose_rounds 欄）另列，不算違規。\n不證明 exactly-once；只證明在 E1/E2 中 intent 與 logical operation 一對一、分母固定，故舊分母可沿用。steward 臂 re-propose 仍是 stub（未實作），不在此證明範圍。\n")
print(json.dumps(summ, ensure_ascii=False)); print([r for r in res if r['violations']][:3])
