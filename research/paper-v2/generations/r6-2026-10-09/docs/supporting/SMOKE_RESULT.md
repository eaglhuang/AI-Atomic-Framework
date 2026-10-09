# ATM v2 harness — SMOKE RESULT (smoke-seed42)

- run_id: `smoke-seed42` · scenario_seed: **42** · atm_backend: **mock** (mock broker, NOT the real ATM monorepo) · writer: mock
- params: `{"n_agents":4,"hot_ratio":0.4,"overlap":"med","cold_policy":"queue","composer_enabled":true,"trial_count":40,"tick_interval_ms":50,"hold_ms_min":20,"hold_ms_max":60,"jitter_ms":15,"idle_prob":0.1,"queue_timeout_ms":2000,"max_provisional_depth":1}`
- scenario reproducibility (meta / atm snapshot / control snapshot / regenerated sha256 equal): **true** (`c05b6019aae3f13a…`)
- alignment: 141 intents present in both modes (atm_only=0, control_only=0)

## Headline numbers

| metric | atm (mock) | control (no ATM) |
|---|---|---|
| trials | 40 | 40 |
| intents (decision events) | 141 | 141 |
| contended intents (ground truth ≠ no_conflict) | 67 | 67 |
| events_total | 476 | 423 |
| event types | submit=141, decision=141, oracle=140, enqueue=27, dequeue=27 | submit=141, decision=141, oracle=141 |
| bytes (JSONL) | 263046 | 200579 |
| duration_ms | 2174 | 2021 |
| distinct agents / vendors | 4 / claude,codex,cursor | 4 / claude,codex,cursor |
| outcomes | commit=140, reject=1 | commit=141 |
| committed | 140 | 141 |
| oracle pass (marker survives) | 140 | 99 |
| lost updates (oracle fail) | 0 | 42 |
| integration pass rate of committed | 100% | 70.2% |
| effective success rate of all intents | 99.3% | 70.2% |
| racy_overwrite decisions | 0 | 47 |
| serialized (queued) | 27 | 0 |
| composer co-writes | 12 | 0 |
| CAS rebase on apply | 19 | 0 |
| mean wait_ms (all intents) | 9.4 | 0 |
| mean wait_ms (waited only) | 39.2 (n=34) | 0 (n=0) |
| p95 / max wait_ms | 63 / 106 | 0 / 0 |

## Decision histogram

| decision | atm | control | atm mean wait_ms |
|---|---|---|---|
| composer_merge | 12 | 0 | 0 |
| admit | 94 | 0 | 0 |
| hot_provisional | 7 | 0 | 18.4 |
| cold_queue | 27 | 0 | 44.6 |
| reject | 1 | 0 | 0 |
| direct_write | 0 | 141 | — |

## Reason codes

- atm: cold_free=58, hot_no_overlap=31, cold_queued_then_granted=27, hot_disjoint_region_cowrite+cas_rebase=7, hot_same_region_speculative+cas_rebase=7, hot_disjoint_region_cowrite=5, hot_no_overlap+cas_rebase=5, provisional_depth_exceeded=1
- control: clean=86, racy_overwrite=47, concurrent_no_clobber=8

## Ground-truth label vs decision (atm)

| expected_class | decisions |
|---|---|
| composer_cowrite | admit=10, composer_merge=8 |
| no_conflict | admit=65, composer_merge=3, hot_provisional=3, cold_queue=3 |
| hot_provisional | hot_provisional=4, admit=3, reject=1, composer_merge=1 |
| cold_queue | cold_queue=24, admit=16 |

## Ground-truth label vs decision (control)

| expected_class | decisions |
|---|---|
| control_racy_write | direct_write=67 |
| no_conflict | direct_write=74 |

## Contended intents: atm vs control final result (aligned by intent_id)

- atm:test_pass / control:test_fail: 39
- atm:test_pass / control:test_pass: 27
- atm:reject / control:test_fail: 1

## Data volume

- events_total=899, bytes=463625, duration_ms=4195

## Feasibility conclusion

The minimal harness runs end-to-end on this box with zero dependencies (Node v20.19.2): a pure, seeded scenario generator (seed 42; snapshot hash reproducible = true), 4 concurrent mock agents labelled across vendors (claude/codex/cursor), append-only per-agent JSONL for both modes, and an exporter that produces the atm-vs-control alignment table. With the **mock** broker (cold_policy=queue, composer=true), ATM mode committed 140/141 intents with 0 lost updates, using 27 cold queues (mean wait among waited intents 39.2 ms), 12 composer co-writes and 7 hot provisionals, while control (direct write, no broker) committed 141/141 but lost 42 updates (47 racy overwrites), i.e. effective success 99.3% vs 70.2%. This demonstrates the pipeline, schema and the measurable "block → queue" / hot-composer contrast are feasible; the numbers are mechanism-level only, because the broker is a mock modelled on the spec (not the real ATM monorepo), agents are in-process async workers rather than separate vendor sessions, and decisions are timing-dependent (scenarios are deterministic, admission order is not bit-identical across reruns). Next steps: swap MockBroker for the real ATM broker API behind the same AtmGateway interface, add a cold_block arm, and run multi-process/multi-vendor ticks at overnight scale.

---
Generated 2026-10-06T16:58:29.009+08:00 by `node src/cli.mjs export --run-id smoke-seed42 --report SMOKE_RESULT.md`. Raw: `runs/smoke-seed42/{atm,control}/events/*.jsonl`; tables: `runs/smoke-seed42/export/`.
