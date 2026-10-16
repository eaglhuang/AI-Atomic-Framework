# STATUS: INVALID (kit-error) — do not cite

Run 20261016T162959Z-3059031-24779, main 526ba8eea (#327 merged), boundary unix-user, model gpt-6-luna, reasoning_effort=medium, Codex 0.163.0.

Kit errors:
1. Test environment: the run venv has no Django installed (`ModuleNotFoundError: No module named 'django'`). setup-tests.log shows `django test runner exit 1`, but setup.sh exited 0. All FAIL_TO_PASS/PASS_TO_PASS rows for both arms are `not-seen`, so test outcomes are null.
2. evaluate.py reported `status: ok` despite zero tests being observed.
3. Test patch for django__django-11141 was not applied in either arm (`testPatchApplied: false`).
4. seal.sh --publish-index printed the row path `prereg-v3-smoke/2026-10-16-codex/` instead of this directory and appended nothing to EVIDENCE_INDEX.md.
5. Arm B: steward recomposeOrRetry=0 although 4 of 5 writes were rejected (`patch-context-mismatch`), so the retry count is inconsistent with the logs.
