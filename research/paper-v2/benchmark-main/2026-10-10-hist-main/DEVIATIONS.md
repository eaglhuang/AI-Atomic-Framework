## Deviations (times Asia/Taipei)
1. **2026-10-10 00:45:04 — §5.7 stop after the SymPy batch** (see STOP_REPORT.md). 2,500 of 9,750 planned runs executed;
   xarray/pytest/Sphinx/FastAPI main batches, O0 and old-pin sets and the semantic endpoint not executed.
2. **Batch order** (not specified in the prereg): main per project in the order django, sympy, xarray, pytest, sphinx, fastapi,
   then O0, then old pin; the stop check runs after each project batch so a batch's denominator is always complete.
3. **Concurrent load:** while the Django/SymPy batches ran, short semantic-environment probes (single pairs, empty run sets)
   used the same CPU. Run timing therefore varies; seeds fix the schedule, not wall-clock interleaving (as in the pilot).
4. **Semantic endpoint preparation (not run):** `semantic-prep/semantic_multi.py` = pilot semantic.py with identical scoring;
   Django keeps the pilot runner; other projects run `python -m pytest -p no:cacheprovider -rA --tb=no -q
   --continue-on-collection-errors -W ignore::DeprecationWarning -W ignore::PendingDeprecationWarning` on the test modules touched
   by the union test patch. Env deviations: one Python 3.13 env per project (freeze files in `semantic-prep/envs/`), newer than
   many 2024 bases; FastAPI uses one of 7 envs chosen per pair as the highest prebuilt Starlette version allowed by the base's
   pyproject (lists in `semantic-prep/lists/`); pytest's setuptools_scm `_pytest/_version.py` (absent from `git archive`) is
   stubbed as `99.0.0+hist`; xarray pinned numpy<2.3, pandas<2.4, scipy<1.17. Probes on 7 pairs only checked that the envs
   collect and run tests (`semantic-prep/env-probes/`); they are not results.
5. **bare_composer duplicate insert** (django:20101_20282 seeds 0, 1) is a baseline result (admission bypassed), reported, not
   investigated further in this generation.
6. No ATM or harness change; no token in any file (grep-checked).
