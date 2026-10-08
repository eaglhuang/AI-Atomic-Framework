# D2 — Optimistic CAS + retry baseline (`occ`)

**Status:** done (2026-10-07 21:29 CST)  
**Harness:** `/workspace/reports/atm-v2-harness`  
**ATM pin:** `5692474f7db70ab52a7a71c8af4867609e7e4b43` (no ATM source edits)

## Story

D2 answers **OCC cost vs steward compose**: agents hold/think **without** a per-file exclusive lock (contrast D1 `file_lock`). After hold, if the file version drifted from the admit-time base (or a race loses the CAS after a yield), the writer **rebuilds** the marker insert on current bytes and retries, bounded by `--occ-max-retries` (default 8). Exhaust → `outcome: blocked`, `reason_code: occ_retries_exhausted` (no infinite loop).

## Arm mapping

| CLI `--arm` | aliases | `mode` | `atm_writer` | `arm_role` | `diagnostic` | `correctness_competitor` |
|-------------|---------|--------|--------------|------------|--------------|--------------------------|
| `occ` | `cas_retry`, `optimistic` | `atm` | `occ` | `baseline_occ` | `false` | `true` |
| `file_lock` (D1) | `serial`, … | `atm` | `file_lock` | `baseline_serial` | `false` | `true` |
| `steward` (main) | `main` | `atm` | `steward` | `main_method` | `false` | `true` |

Params: `occ_max_retries` (default 8), CLI `--occ-max-retries N` (0..64).

## Semantics (frozen)

1. ATM admit as usual; record `admit_base_version = ticket.base_version`.
2. **Hold unlocked** (no `FileLockTable`); optional promotion wait same as other ATM arms.
3. OCC loop:
   - If `broker.version(path) !== planned` → `cas_retry++`, rebuild plan on current version; if `cas_retry > occ_max_retries` → blocked.
   - Read current bytes → `insertIntoRegion` → `await sleep(0)` (yield for interleaving) → if version still matches, write + `broker.bump`; else continue.
4. Event fields: `atm_writer: 'occ'`, `cas_retry`, `repropose_rounds` (= cas_retry), `admit_base_version`, `occ_max_retries`, `composer: false`, `serialized: false`.
5. C3 oracle runs on final worktree (independent of ATM verdicts).

## Smoke compare (seed 11, agents 3, trials 5, hot=1, overlap=high, hold 8–25 ms, real ATM)

| arm | correct | lost | committed | blocked | cas_retry Σ / mean / max | mean lock_wait_ms | wall_ms | mean overhead_ms |
|-----|---------|------|-----------|---------|--------------------------|-------------------|---------|------------------|
| **occ** | 15 | 0 | 15 | 0 | 6 / 0.40 / 2 | 0 | 175.45 | 12.43 |
| **file_lock** | 15 | 0 | 15 | 0 | 9† / 0.60 / 1 | 8.10 | 227.59 | 21.29 |
| **steward** | 15 | 0 | 15 | 0 | 3† / 0.20 / 1 | 0 | 573.87 | 59.08 |
| occ `--occ-max-retries 0` | 10 | 0 | 10 | **5** | 5 / 0.33 / 1 | 0 | 165.76 | 9.90 |

† On file_lock/steward, `cas_retry` is the legacy 0/1 “version drifted vs admit” flag, not OCC rebuild rounds.

Runs: `runs/d2-occ`, `runs/d2-file_lock`, `runs/d2-steward`, `runs/d2-occ-exhaust`.  
Raw JSON: `runs/steward-writer/d2_compare_raw.json`.

### Reproduce

```bash
export ATM_MONOREPO=/path/to/AI-Atomic-Framework-5692474f…
COMMON='--seed 11 --agents 3 --trials 5 --hot-ratio 1 --overlap high --hold-ms-min 8 --hold-ms-max 25 --jitter-ms 6 --tick-interval-ms 15 --compose-window-ms 80 --atm-backend real --force'
node src/cli.mjs start --arm occ --run-id d2-occ $COMMON --occ-max-retries 8
node src/cli.mjs start --arm file_lock --run-id d2-file_lock $COMMON
node src/cli.mjs start --arm steward --run-id d2-steward $COMMON
```

## Files changed

- `src/arms.mjs` — `occ` arm (`baseline_occ`), aliases `cas_retry`/`optimistic`
- `src/runner.mjs` — OCC path in `AtmGateway.execute`; `occ_max_retries` wiring
- `src/cli.mjs` — `--arm occ`, `--atm-writer occ`, `--occ-max-retries`
- `src/scenario.mjs` — `occ_max_retries` default
- `src/mp-worker.mjs` — pass `occ_max_retries`
- Docs: this file + `runs/baselines/D2.md`

## Gaps → D3 (Git three-way)

- Multi-process OCC (cross-process version/CAS) not yet; in-process yield approximates contention.
- No git merge-base / `git merge-file` path yet — D3 should apply via three-way merge on worktree blobs.
- `logical_id` still stubbed to `intent_id` (C3/E).
- Full artifact_manifest / reproduce.sh (A5/F3) still open.

**Next default: D3** Git three-way baseline.
