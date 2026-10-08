---
name: atm-bench
description: Join or start an ATM hot/cold admission benchmark run (atm or control mode) and keep producing write-intent events. Vendor-neutral (Cursor / Claude / Codex). Supports atm_backend mock|real.
status: active (0.3.0-latency; dual small runs + latency compare)
---

# atm-bench skill

All commands run from harness root: `/workspace/reports/atm-v2-harness`.
For **`atm_backend=real`**, use **Node ≥22** (recommended: nvm Node 24).

```bash
export NVM_DIR=/workspace/.nvm; . "$NVM_DIR/nvm.sh"; nvm use 24
cd /workspace/reports/atm-v2-harness
```

## Rules for the calling model
1. Confirm (or read `ATM_BENCH_RUN_ID`, `ATM_BENCH_MODE`, `ATM_BENCH_SEED`) the `run_id`, `mode` (`atm` | `control`) and `scenario_seed`.
2. Join with **start**. Stable `agent_id` = `<vendor>:<session>`.
3. Loop **tick** until status exhausted / stop. Never edit fixture files around the gateway.
4. Never delete/rewrite `runs/` raw JSONL.
5. ATM admission never trusts model self-report; use broker decision codes.
6. Label clearly: meta.`atm_backend` is `mock` | `real` | `none` (control-only).

## Dual small runs (ATM on vs off)

```bash
# Run A — REAL ATM, 6 concurrent workers, 30 trials
node src/cli.mjs run-small --mode atm --seed 42 --run-id small-atm-seed42 \
  --agents 6 --trials 30 --atm-backend real --force

# Run B — CONTROL (no broker), same seed
node src/cli.mjs run-small --mode control --seed 42 --run-id small-control-seed42 \
  --agents 6 --trials 30 --force
```

Compare: [COMPARE_SMALL.md](../../COMPARE_SMALL.md). Latency/slowdown: `node src/cli.mjs compare-latency --atm-run <id[,id…]> --control-run <id[,id…]> --report COMPARE_LATENCY.md` → [COMPARE_LATENCY.md](../../COMPARE_LATENCY.md).

## atm_bench_start
```
node src/cli.mjs start --run-id <id> --mode atm|control|both --seed <n> \
  --atm-backend mock|real --agents 4..8 --trials 20..40 \
  --agent-id <vendor:session> --vendor cursor|claude|codex|other [--force]
```
Creates `runs/<id>/meta.json` + scenarios. Existing run: seed/params/backend must match.
Returns `[{ run_id, mode, status, atm_backend, agents, next_hint }]`.

## atm_bench_tick  (STUB for external proposals)
```
node src/cli.mjs tick --run-id <id> --mode atm|control --agent-id <vendor:session>
```
Returns next pending intent. In-process workers (`writer=mock`) produce the JSONL; cross-process admit TBD.

## atm_bench_status / stop
```
node src/cli.mjs status --run-id <id>
node src/cli.mjs stop   --run-id <id> --mode atm|control
```

## atm_bench_export
```
node src/cli.mjs export --run-id <id> [--report path.md]
```

## Real ATM evidence fields
When `atm_backend=real`, decision events include `atm_disposition`, `atm_verdict`, `atm_lane`, `atm_reason`, `atm_write_intent_task`. Registry: `<mode>/worktree/.atm/runtime/write-broker.registry.json`.
