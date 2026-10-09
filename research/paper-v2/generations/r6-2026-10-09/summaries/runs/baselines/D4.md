# D4 — Bare composer baseline (`bare_composer`)

**Status:** done (2026-10-07 21:33 CST)  
**Harness:** `/workspace/reports/atm-v2-harness`  
**ATM pin:** `5692474f7db70ab52a7a71c8af4867609e7e4b43` (no ATM source edits)

## Goal

Isolate **composition gains** vs **routing/admission governance**: keep the same synthesis + guarded steward apply as the main steward path, but **turn off broker admission**.

## How admission is bypassed (documented choice)

**Stub broker `BareAdmitBroker`** (`src/bare-admit-broker.mjs`) — not a wrap-and-skip of `RealAtmBroker.admit`.

| | Full steward | Bare composer (D4) |
|--|--------------|---------------------|
| Admit | `RealAtmBroker.admit` (registry leases, hot/cold, queue, provisional) | **`BareAdmitBroker.admit`**: always `decision=composer_merge`, `reason_code=bare_composer_bypass`, `wait_ms=0` |
| Leases / queue | Yes | **No** |
| Compose window | `ComposeWindowManager` | **Same** |
| Synthesis | `composeBrokerProposals` (ATM pin) | **Same** |
| Apply | `applyStewardPlan` + neutral steward | **Same** |
| Capability | `backend: real` | `backend: bare_admit`, `admission_bypassed: true` |

Even with `--atm-backend real`, this arm **forces** `BareAdmitBroker` (see `artifacts/admission_bypass.json`). ATM pin APIs are still used inside the compose/apply path.

Because every ticket is `composer_merge`, `resolveExpectedCount` uses **timeout-only** peer collection (`expectedCount=∞`). Full steward often admits same-region peers as `hot_provisional` → `expectedCount=1` → immediate solo batch, avoiding overlap in one compose.

## Arm mapping

| CLI `--arm` | aliases | `atm_writer` | `arm_role` | `diagnostic` | `correctness_competitor` |
|-------------|---------|--------------|------------|--------------|--------------------------|
| `bare_composer` | `composer_only`, `bare` | `bare_composer` | `baseline_bare_composer` | `false` | `true` |

## Smoke (seed 11, agents 3, trials 5, hot=1, overlap=high, hold 8–25 ms)

| arm | correct | lost | committed | blocked | rejects | mean wait | mean admit | mean overhead | wall_ms | decisions |
|-----|---------|------|-----------|---------|---------|-----------|------------|---------------|---------|-----------|
| **bare_composer** | 12 | 0 | 12 | 3 | 0 | 0 | 0.03 | 118.32 | 732.54 | `{'composer_merge': 15}` |
| **steward** | 15 | 0 | 15 | 0 | 0 | 11.6 | 15.06 | 59.49 | 567.12 | `{'composer_merge': 6, 'hot_provisional': 9}` |
| **occ** | 15 | 0 | 15 | 0 | 0 | 4.2 | 7.95 | 12.95 | 178.59 | `{'composer_merge': 4, 'hot_provisional': 11}` |

### Interpretation

- **Bare** still composes correctly when patches are disjoint (`parallel-safe` batches applied; majority of intents commit).
- **Bare vs steward rejects/waits:** bare `mean_wait≈0`, `mean_admission≈0`, all 15 decisions `composer_merge`. Steward has non-zero wait/admit and mix of `composer_merge` + `hot_provisional`.
- **Bare blocked=3:** one timeout batch of 3 overlapping `src/routes.ts` proposals → ATM compose `needs-steward` / `steward-final-patch-required` (same-line overlap). Full steward serialized those via provisional (solo batches) → correct=15. This is the ablation signal: **admission routing avoided a compose conflict that bare forced into one window**.

Runs: `runs/d4-bare_composer`, `d4-steward`, `d4-occ`. Raw: `runs/steward-writer/d4_compare_raw.json`.

### Reproduce

```bash
export ATM_MONOREPO=/path/to/AI-Atomic-Framework-5692474f…
COMMON='--seed 11 --agents 3 --trials 5 --hot-ratio 1 --overlap high --hold-ms-min 8 --hold-ms-max 25 --jitter-ms 6 --tick-interval-ms 15 --compose-window-ms 80 --atm-backend real --force'
node src/cli.mjs start --arm bare_composer --run-id d4-bare_composer $COMMON
node src/cli.mjs start --arm steward --run-id d4-steward $COMMON
node src/cli.mjs start --arm occ --run-id d4-occ $COMMON --occ-max-retries 8
```

## Files changed

- `src/bare-admit-broker.mjs` — stub always-`composer_merge` broker
- `src/arms.mjs` — `bare_composer` / `baseline_bare_composer` + aliases
- `src/runner.mjs` — shared steward compose path; force BareAdmitBroker; git init; batch sink
- `src/cli.mjs`, `src/scenario.mjs`
- Docs: this file + `runs/baselines/D4.md`

## Gaps → D5 (full ATM composer+steward packaging)

- D5 should package **steward** as the explicit main-method arm for RQ2 matrices (labels, default `--arm`, figure footnotes) without further writer changes if C1 already complete.
- Bare does not auto-fallback overlapping batches to provisional/serial (by design).
- Multi-process bare admit stub not wired in `mp-worker` beyond AtmGateway writer string.
- `logical_id` still stubbed to `intent_id`.

**Next default: D5** full ATM composer+steward (main method packaging).
