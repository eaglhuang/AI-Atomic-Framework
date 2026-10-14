"""Path classes copied from HIST v1.x frozen-trial build_pairs.py.

Auto-expansion uses them only to choose target source files. An explicit
target_file is classified even when it would be skipped here. Size is never
an exclusion.
"""

from __future__ import annotations

import os
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


def repo_relative_path_issue(path: str) -> str | None:
    """Return why a path is unsafe, or None when it may be a git target.

    Unsafe, and still rejected: a non-string or empty path, a NUL, an absolute
    path, a Windows drive or UNC prefix, and any empty, ``.``, or ``..``
    segment. Those can leave the repository.

    A backslash is a filename character, not a separator. Quotes, tabs,
    newlines, non-ASCII, spaces, and a leading dash are legal and must survive
    classification. This function does not reject them.
    """
    if not isinstance(path, str) or path == "":
        return "not-a-path"
    if "\0" in path:
        return "nul"
    if path.startswith("/"):
        return "absolute"
    if len(path) >= 2 and path[0].isalpha() and path[1] == ":":
        return "absolute"
    if path.startswith("\\\\"):
        return "absolute"
    if any(part in ("", ".", "..") for part in path.split("/")):
        return "escapes-repo"
    return None


def _contained_repo_path(root: str, rel: str) -> str | None:
    if repo_relative_path_issue(rel):
        return None
    return os.path.join(root, *rel.split("/"))
