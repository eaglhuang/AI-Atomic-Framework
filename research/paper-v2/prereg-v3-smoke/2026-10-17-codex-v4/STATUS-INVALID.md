# STATUS: INVALID (kit-error) — do not cite
Run 20261016T204658Z-3129300-980, main 0dd9dbeca (#333 merged), unix-user, gpt-6-luna, medium. results.json status=invalid. Added after seal; not in SHA256SUMS.
1. tests-unobserved (A/13820, B/13820): Django ran 18 tests (Ran 18 tests, FAILED failures=1) but the parser marked all 18 not-seen. Django 3.2 --verbosity 2 prints "test_x (module.Class)" with docstring lines before "... ok", and "FAIL: test_x (module.Class)"; the parser does not match this format.
2. test-patch-not-applied (A/11141, B/11141): still `patch failed: tests/migrations/test_loader.py:508` and `test_migrations_namespace_package/0001_initial.py`-related errors after the reset fix; the reset does not cover the 11141 test-patch files (or the 13820 final edits overlap them).
