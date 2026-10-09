# §5.7 STOP — steward counterexample in the HIST main run (2026-10-10, Asia/Taipei)

**Status: main run STOPPED by the pre-registered stop rule after the SymPy project batch (2,500 of 9,750 planned runs).**
Author-executed, not independently reproduced. Reported in full; not hidden, not offset by completion rates.

## What happened
- Pair `sympy:26412_26438` (stratum O1, rule v1.1-P, o1_kind divergent; writer 26412 = pre-rebase head, writer 26438 = final).
- steward (ATM pin 20effd45) failed in 4 of 5 seeds (k = 0, 1, 3, 4). Each failed run: **1 lost effect + 1 corrupted file**
  (`sympy/physics/mechanics/actuator.py`), 0 structure violations, 0 extra files. Seed 2: writer 26438 won the file and writer
  26412's hunks were blocked at harness relocation (no failure).
- Per run, the oracle reports hunk h3 of writer 26412 (insert of class `CoulombFrictionActuator` at end of file) as
  `lost / partial_effect`, the file as frame-violated (`foreign_line` at the last line), and the other 3 acked hunks of that file
  as `block_intact_file_corrupted`.

## Root cause (deterministic, single writer, no concurrency)
- PR 26412's pre-rebase head ends `actuator.py` **without a trailing newline**. The hunk's last post-image line has no `\n`.
- The harness proposal (`patchkit.unifiedPatch`) correctly emits `\ No newline at end of file` after that line.
- `git apply` of the same patch gives exactly the oracle's expected bytes.
- **ATM's steward apply (composeBrokerProposals → applyStewardPlan) writes the file WITH a trailing `\n`** (final = expected + 1
  byte). Reproduced outside the benchmark with one writer and no concurrency: `forensics/repro_eof.mjs`,
  output `forensics/repro_eof_output.txt`. **Same result at the old pin 5692474f**, so this is a long-standing ATM patch-apply
  defect (the "No newline at end of file" marker is ignored), not related to PR #213/#214/#216/#238 and not a concurrency race.
- bare_composer (same ATM apply path, admission bypassed) shows the same corruption on this pair (seed 0).
- Under the oracle's full-byte rule this is a corrupted file and a lost (partial) effect. The byte difference is a single EOF
  newline; the code itself is present. It is reported as a §5.7 counterexample as pre-registered.

## Exposure in the frozen sample
- A scan of all 300 main pairs + 30 O0 pairs (any hunk pre/post line or base file without a trailing newline) finds **exactly one
  pair: `sympy:26412_26438`**. The remaining 4 projects (xarray, pytest, Sphinx, FastAPI), the O0 set and the old-pin set contain
  no pair that can trigger this defect; the old-pin set does contain this pair.

## Stop-rule actions taken
- Raw artifacts of the 4 failing runs are kept (`raw/main/sympy/runs/sympy_26412_26438__steward__s{0,1,3,4}/`, incl.
  `final_failing/`). The SymPy batch was completed so the denominator is whole (driver checks after each project batch).
- Not run: xarray, pytest, Sphinx, FastAPI main batches (5,000 runs), O0 (750), old pin (1,500); the semantic endpoint (envs
  built and probed, see `semantic-prep/`). Nothing in ATM or the harness was changed.
- Next step needs the author: (a) fix ATM (honour `\ No newline at end of file`), new pin, new generation re-running the plan;
  and/or (b) continue the remaining runs at the same pin as a separately labelled continuation. Neither was started.
