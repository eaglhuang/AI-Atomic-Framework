## Deviations (times Asia/Taipei)
1. **New ATM pin (user decision).** b1fd9d22 replaces the prereg pin 20effd45 for every current-pin run. It is PR #252, the
   EOF-newline fix after the §5.7 stop of `2026-10-10-hist-main`. packages/core/src differs only in unified-patch.ts,
   steward-base-composer.ts, steward-region-rebase.ts and steward.ts. Everything else is the frozen prereg v1.1 design: sample,
   seeds, arms, harness, oracle, old pin 5692474f and stop rule.
2. **Batch order** (not in the prereg): main per project (django, sympy, xarray, pytest, sphinx, fastapi), then O0, then old pin.
   The §5.7 check runs after each project batch and after O0. It is identical to the stopped generation.
3. **Pre-run forensics.** One 25-run batch of sympy:26412_26438 at b1fd9d22 (`forensics/pair_run/`) ran before the main run as
   the gate. It is not part of the 9,750-run denominators.
4. **Semantic endpoint.**
   - Runner: `semantic/semantic_multi.py` (sha in PINS), the pilot semantic.py with identical scoring. Django keeps the pilot
     runner. Other projects run `python -m pytest -p no:cacheprovider -rA --tb=no -q --continue-on-collection-errors -W
     ignore::DeprecationWarning -W ignore::PendingDeprecationWarning` on the test modules touched by the union test patch.
   - Python: one Python 3.13 env per project (freezes in `semantic/envs/`). These are newer than many 2024 bases.
   - FastAPI: one of 7 Starlette envs per pair, the highest prebuilt version the base's pyproject allows.
   - pytest: `_pytest/_version.py` is stubbed as 99.0.0+hist.
   - xarray: numpy<2.3, pandas<2.4, scipy<1.17.
   - The semantic jobs started after all write-safety runs finished (no CPU overlap).
   - Env probes from the previous generation are copied in `semantic/env-probes/`. They are not results.
5. **Old-pin losses** (25 failed runs) are a secondary-set result, not a stop condition. §5.7 applies to the current pin.
6. **Box hiccups.** The agent session was interrupted three times during the semantic stage (tool calls failed for a while). The
   detached jobs kept running: one orchestrator process, `semantic_all_v2.log` is continuous, and the agent restarted nothing. The write-safety
   batches finished before the first interruption.
7. No ATM or harness change during the run. No token in any file (grep-checked). Earlier generations are unchanged.
