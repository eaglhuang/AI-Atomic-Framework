# atm-bench: ATM Hot/Cold Admission Harness

| 欄位 | 內容 |
|------|------|
| Version | 0.3.0-latency |
| Backends | `atm_backend: mock` **或** `atm_backend: real`（AI-Atomic-Framework monorepo） |
| Specs | [PLAN_SPEC.md](./PLAN_SPEC.md), [FUNCTIONAL_SPEC.md](./FUNCTIONAL_SPEC.md) |
| Dual small compare | [COMPARE_SMALL.md](./COMPARE_SMALL.md) |
| Latency / slowdown | [COMPARE_LATENCY.md](./COMPARE_LATENCY.md) |
| Cold same-file queue | [COLD_QUEUE_LATENCY.md](./COLD_QUEUE_LATENCY.md) |
| Hot file (provisional/composer) | [HOT_FILE_LATENCY.md](./HOT_FILE_LATENCY.md) |
| Multi-process (shared registry) | [MULTIPROCESS_SMALL.md](./MULTIPROCESS_SMALL.md) |
| Scale prelude | [SCALE_PRELUDE.md](./SCALE_PRELUDE.md) |
| Checklist | [REMAINING_TESTS.md](./REMAINING_TESTS.md) |
| 不做 | Claim Plane JIT、npm publish、CloudAgent |

## Quick start（Node ≥22 for real；建議 nvm Node 24）

```bash
export NVM_DIR=/workspace/.nvm; . "$NVM_DIR/nvm.sh"; nvm use 24
cd /workspace/reports/atm-v2-harness

# Mock smoke (both modes, one run_id)
node src/cli.mjs run-smoke --run-id smoke-seed42 --atm-backend mock --force --report SMOKE_RESULT.md

# Dual small runs (ATM on vs off), same scenario_seed, 4–8 agents
node src/cli.mjs run-small --mode atm     --seed 42 --run-id small-atm-seed42     --agents 6 --trials 30 --atm-backend real --force
node src/cli.mjs run-small --mode control --seed 42 --run-id small-control-seed42 --agents 6 --trials 30 --force
# → see COMPARE_SMALL.md

# ATM slowdown vs control (latency/throughput); comma lists = repetitions
node src/cli.mjs compare-latency --atm-run small-atm-seed42 --control-run small-control-seed42 --report COMPARE_LATENCY.md
# Unpaced stress (no think time): add --tick-interval-ms 0 --hold-ms-min 0 --hold-ms-max 0 --jitter-ms 0

# Hot-file knobs (real backend): --hot-retry none|loop  --atm-writer sync|stale   → HOT_FILE_LATENCY.md
# Multi-process: one OS process per agent, shared worktree + ATM registry (CAS)   → MULTIPROCESS_SMALL.md
node src/cli.mjs run-mp --mode atm --run-id mp-x --seed 42 --agents 8 --trials 40 --atm-backend real [--procs 4] \
  [--registry-sync cas|naive] [--apply-lock on|off] --force

# Generic start
node src/cli.mjs start --run-id ID --mode atm|control|both --seed N \
  --atm-backend mock|real --agents 4..8 --trials 20..40 [--force]
```

Aliases: `--agents` ≡ `--n-agents`, `--trials` ≡ `--trial-count`.

## Layout

```
src/cli.mjs            start | run-smoke | run-small | tick(stub) | status | stop | export
src/scenario.mjs       pure seeded generator + ground-truth labels
src/mock-broker.mjs    MOCK ATM (in-process behavioural model)
src/real-broker.mjs    REAL ATM: calculateBrokerDecision + evaluateBrokerAdmission + register/release
src/atm-resolve.mjs    locate /workspace/AI-Atomic-Framework (or ATM_MONOREPO)
src/runner.mjs         N async agent workers (Promise.all); AtmGateway | ControlWriter
src/mp-runner.mjs      run-mp: fork N mp-worker processes, shared worktree/registry, oracle + invariants
src/mp-worker.mjs      one OS process per agent (or slot group)
src/mp-broker.mjs      REAL ATM across processes: createBrokerRegistryStore CAS txns, registry polling, apply lock
src/arm-stats.mjs      pooled per-arm stats for phase reports
src/control-writer.mjs direct write, observes races only
src/export.mjs         summary / decisions.csv / trials.csv
fixture/               TypeScript mini-app (hot/cold files + region markers)
skills/atm-bench/      vendor-neutral SKILL.md
runs/<run_id>/         meta.json (labels real vs mock), {atm,control}/…, export/
```

## Timing fields (0.3.0-latency)

`decision` events carry `latency_ms` (submit→decision), `wait_ms`, `broker_ms`, `hold_ms`, `promotion_wait_ms`, `apply_ms`, `total_ms`, `overhead_ms` (=total−hold), `schedule_lag_ms`, `t_submit_ms`, `t_done_ms` (performance.now, ms). Run-level `wall_clock_ms` + throughput in `meta.json` and `export/summary.json → modes.<m>.latency`; per-event `export/timings.csv`. See COMPARE_LATENCY.md for definitions and caveats (single process / shared event loop).

## atm_backend: real — what is actually invoked

| API | Path |
|-----|------|
| `calculateBrokerDecision` | `AI-Atomic-Framework/packages/core/src/broker/decision.ts` |
| `evaluateBrokerAdmission` | `…/broker/admission/evaluate-broker-admission.ts` |
| `registerIntent` / `releaseTask` / `saveRegistry` | `…/broker/registry.ts` |

Decision mapping (honest):

| ATM disposition | Harness `decision` |
|-----------------|--------------------|
| `direct` | `admit` |
| `proposal-required` | `hot_provisional` |
| `compose` | `composer_merge` |
| `queue` | `cold_queue` |
| `true-conflict` | `reject` (or `cold_block` if cold + `cold_policy=block`) |
| `revalidate` | `reject` |

Events also store `atm_disposition`, `atm_verdict`, `atm_lane`, `atm_reason`. Worktree gets `.atm/runtime/write-broker.registry.json`.

## Gaps（real backend）

- Same-file **cold** overlaps return ATM `compose` with per-intent atomIds (default). Native `disposition=queue` is **unreachable** in core@0.1.2 (no decision emits `lane:'serial'`). Use `--overlap cold-same-file --cold-atom-identity region --cold-retry loop` to get ATM `true-conflict` + harness wait/re-ask overlay (wait_ms>0). See COLD_QUEUE_LATENCY.md.
- Optional harness overlay: on cold + `true-conflict` with `cold_policy=queue`, wait+retry once; final codes still from ATM.
- Shared-surface freeze/ack CLI workflow not driven end-to-end.
- `tick` still stub for external LLM proposals (in-process mock writer produces data).
- **No Claim Plane.**

## Semantics (unchanged from smoke)

- Same seed → identical Scenario snapshot hash for atm/control pairing.
- Agents: `cursor:mock-s0` … up to 8 slots; independent async loops; contention from timing.
- Control: no broker; last-writer-wins; `racy_overwrite` observed.
- Oracle: committed intent marker must remain in final worktree.

## Env

| Var | Meaning |
|-----|---------|
| `ATM_MONOREPO` | Override path to AI-Atomic-Framework |
| `ATM_BENCH_BACKEND` | Default `--atm-backend` |
| `ATM_BENCH_RUN_ID` / `MODE` / `SEED` | Skill defaults |
