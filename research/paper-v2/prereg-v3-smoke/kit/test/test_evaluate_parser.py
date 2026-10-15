#!/usr/bin/env python3
"""Django verbosity 2 解析器的固定樣本測試。"""
import pathlib
import sys

KIT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT / "bin"))
import evaluate  # noqa: E402

FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"
VERBOSE = (FIXTURES / "django-verbosity-2.txt").read_text(encoding="utf-8")
QUIET = (FIXTURES / "django-verbosity-1.txt").read_text(encoding="utf-8")

LABELS = [
    "test_apply (migrations.test_loader.RecorderTests)",
    "test_invalid (migrations.test_loader.PycLoaderTests)",
    "test_loading_package_without__file__ (migrations.test_loader.LoaderTests)",
    "test_load_import_error (migrations.test_loader.LoaderTests)",
    "Migration directories without an __init__.py file are loaded.",
    "test_absent (migrations.test_loader.LoaderTests)",
]


def status_of(parsed, label):
    for item in parsed["tests"]:
        if item["label"] == label:
            return item["status"]
    raise AssertionError(label)


def main():
    parsed = evaluate.parse_test_output("django__django-13820", LABELS, VERBOSE, 1)
    assert status_of(parsed, LABELS[0]) == "pass", parsed
    assert status_of(parsed, LABELS[1]) == "pass", parsed
    assert status_of(parsed, LABELS[2]) == "fail", parsed
    assert status_of(parsed, LABELS[3]) == "fail", parsed
    assert status_of(parsed, LABELS[4]) == "pass", parsed
    assert status_of(parsed, LABELS[5]) == "not-seen", parsed
    assert parsed["passed"] == 3, parsed
    assert parsed["failed"] == 2, parsed
    assert parsed["notSeen"] == 1, parsed

    quiet = evaluate.parse_test_output("django__django-13820", LABELS, QUIET, 1)
    assert all(item["status"] == "not-seen" for item in quiet["tests"]), quiet
    assert quiet["passed"] == 0, quiet
    print("parser fixture ok")


if __name__ == "__main__":
    main()
