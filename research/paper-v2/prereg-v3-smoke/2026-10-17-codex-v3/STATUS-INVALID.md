# STATUS: INVALID (kit-error) — do not cite

Run 20261016T193610Z-3094581-28522, main 68ebe8ab1 (#331 merged), boundary unix-user, gpt-6-luna, reasoning_effort=medium, Codex 0.163.0. results.json status=invalid.

Kit errors (no FAIL_TO_PASS/PASS_TO_PASS observed in any of 4 arm×task evaluations; all null):
1. Gold test patch not applied (test-patch-not-applied) in A/11141, B/13820, B/11141: the final tree already contains model-made edits to tests/migrations/test_loader.py and/or tests/migrations/test_migrations_namespace_package/0001_initial.py (both tasks share files), so `git apply` of the test patch conflicts. Evaluation must reset test files to base before applying the test patch.
2. A/13820 tests-unobserved: Django 3.2 parallel runner crashed with `TypeError: cannot pickle 'traceback' object` (an erroring test under multiprocessing, no tblib). Runner needs `--parallel 1`. setup-tests.log on the base template also ends `FAILED (errors=1)` / `django test runner exit 1`, yet setup.sh reported ok.
3. seal.sh --publish-index wrote the index row without marking the run invalid even though results.json status=invalid.
This file was added after seal and is not in SHA256SUMS.
