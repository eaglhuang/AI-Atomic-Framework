"""Synthetic CLI exposed via [project.scripts]."""

import sys


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    return 0 if not arguments else 1


def run_tests() -> int:
    return 0
