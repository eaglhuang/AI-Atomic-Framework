"""Path classes copied from HIST v1.x frozen-trial build_pairs.py.

Auto-expansion uses them only to choose target source files. An explicit
target_file is classified even when it would be skipped here. Size is never
an exclusion.
"""

from __future__ import annotations

import re

TEST_RE = re.compile(
    r"(^|/)(tests?|testing)/|(^|/)[^/]*_test\.py$|(^|/)test_[^/]*\.py$|(^|/)conftest\.py$"
)
DOC_RE = re.compile(
    r"(^|/)(docs?)/|\.rst$|\.md$|\.txt$|(^|/)\.github/|"
    r"(^|/)changelog[^/]*$|(^|/)release[^/]*notes[^/]*$|(^|/)AUTHORS[^/]*$",
    re.I,
)
VEND_RE = re.compile(r"(^|/)(vendor|_vendor|vendored|third_party|externals|extern)/")
GEN_EXT_RE = re.compile(r"\.min\.js$|\.lock$|\.po$|\.mo$")


def path_class(path: str) -> str:
    if TEST_RE.search(path):
        return "test"
    if DOC_RE.search(path):
        return "doc"
    if VEND_RE.search(path):
        return "vendored"
    if GEN_EXT_RE.search(path):
        return "generated"
    if path.endswith(".py"):
        return "source"
    return "other"


def is_auto_target(path: str) -> bool:
    return path_class(path) in ("source", "other")
