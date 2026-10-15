#!/usr/bin/env python3
"""Tiny stand-in for Django's runtests.py. Prints one line per requested test."""
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent
text = (root / "shared.py").read_text(encoding="utf-8")
checks = {
    "fixture.tests.MarkerTests.test_session_one": "beta-one" in text,
    "fixture.tests.MarkerTests.test_session_two": "delta-two" in text,
    "fixture.tests.MarkerTests.test_untouched": "alpha" in text and "zeta" in text,
}
verbosity = 1
labels = []
args = sys.argv[1:]
index = 0
while index < len(args):
    token = args[index]
    if token == "--verbosity" and index + 1 < len(args):
        verbosity = int(args[index + 1])
        index += 2
        continue
    labels.append(token)
    index += 1
if not labels:
    labels = list(checks)
failed = 0
if verbosity < 2:
    print("." * len(labels))
    print("OK" if all(checks.get(label) for label in labels) else "FAILED")
    sys.exit(0 if all(checks.get(label) for label in labels) else 1)
for label in labels:
    ok = checks.get(label)
    if ok is None:
        print(f"{label} ... ERROR (unknown)")
        failed += 1
    elif ok:
        print(f"{label} ... ok")
    else:
        print(f"{label} ... FAIL")
        failed += 1
sys.exit(1 if failed else 0)
