# HIST-PAIRS harness (ATM paper 2.0, real open-source PR pairs, STALE-style)

Trial stage only (smoke + Django pilot). Pipeline:
1. `mine_search.py` — unauthenticated GitHub Search snapshot of merged PRs (monthly windows 2024-01..2025-12).
2. `build_pairs.py` — PR eligibility + candidate pairs (rules frozen in `SELECTION_RULES.md`, hashes in `SELECTION_RULES.sha256`).
3. `sample_pairs.py` — deterministic smoke/pilot sampling (PCG64 20261009 / 20261008).
4. `annotate_base_exists.py` — adds `base_exists` per path (new files are absent at base); selection unchanged.
5. `src/hist/batch.mjs` — runs pairs x arms x seeds (+ `--plants` for planted faults); each run = `src/hist/run-pair.mjs`:
   2 writer processes (`src/hist/worker.mjs`, one per PR) on one shared worktree (all source files of both PRs at base b), then
   oracle_v2-hist (`src/hist/oracle_hist.mjs`) + python `ast` structure check + extra-file scan.
6. `semantic.py` — STALE semantic endpoint (same union test set everywhere, only new failures after merging).
7. `summarize.py`, `package_trial.py` — tables and sealed trial generation.

## Arms on general patches (submission unit = all hunks of one writer on one file; counting unit = hunk/intent)
- All arms except bare_composer first take real ATM admission (`src/hist/admit.mjs`: calculateBrokerDecision +
  evaluateBrokerAdmission + registerIntent on a shared registry file with CAS; cold 'once' wait policy; release after apply).
- `steward`: after the seeded hold, read current bytes, relocate the writer's hunks (`relocateHunks`: exact
  ctx_before+pre+ctx_after, no fuzz, nearest to base position), build a unified-diff PatchProposal against the current bytes
  (fileBeforeHash = current) and submit through ComposeWindowManager -> composeBrokerProposals -> applyStewardPlan (ATM pin).
  New files: `--- /dev/null` patch on an absent target.
- `bare_composer`: same as steward, admission bypassed.
- `file_lock`: cross-process O_EXCL lockfile per file covering read -> relocate -> atomic write.
- `occ`: read + hash, relocate, yield, re-hash; drift -> retry (max 8) else write (r1-r5 OCC semantics: the re-check->rename
  window is not atomic across processes). Relocation failure -> blocked.
- `git_three_way`: `git merge-file -p current base (base+own hunks)`; conflict -> blocked; live drift right before write ->
  blocked `git-base-drift`; no cross-process lock (r1-r5 D3 semantics).
- Planted faults (oracle validation only): `planted_raw_overwrite` (blind write of base+own hunks), and post-run injections on a
  steward run: `plant_revert_hunk`, `plant_flip_frame_byte`, `plant_torn_tail`, `plant_foreign_file` (+ orphan `.atm-tmp`).

## Oracle (oracle_v2-hist)
Expected bytes from the oracle's own reference applier (base + committed hunks; same-point inserts: any order). Exact match ->
all correct. Otherwise an alignment-free tiling check decides which acked hunks are absent (lost) / which blocked hunks leaked,
with the frame (base lines outside committed ranges) verbatim and in order; no tiling -> corruption (Myers diff only describes it).
Overlapping committed hunks from both writers never pass (`overlap_both_applied`). Run fails on any lost / misplaced / duplicate /
leak / unresolved intent, corrupted file, structure (ast) regression, foreign write or extra file (e.g. leftover `*.atm-tmp`).
Contract + planted-fault unit tests: `node test/hist_oracle_contract.mjs` (19 cases).
