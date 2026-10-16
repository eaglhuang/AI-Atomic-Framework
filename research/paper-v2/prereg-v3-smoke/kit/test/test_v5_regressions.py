#!/usr/bin/env python3
"""v5：11141 的 docstring FAIL_TO_PASS 對成 test_loading_namespace_package，而且 verbosity 2 看得到。"""
import json
import subprocess
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT / "bin"))
import evaluate  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "v5" / "setup-tests.log"
NAMESPACE = "migrations.test_loader.LoaderTests.test_loading_namespace_package"
DOC_LOADED = "Migration directories without an __init__.py file are loaded."


def status_of(parsed, label):
    for item in parsed["tests"]:
        if item["label"] == label:
            return item["status"]
    raise AssertionError(label)


def test_map_keeps_published_ids():
    tasks = json.loads((KIT / "tasks.json").read_text(encoding="utf-8"))
    block = tasks["testIdNormalization"]
    assert block["deviation"] is False, block
    assert block["kind"] == "docstring-to-label"
    inst = next(item for item in tasks["primary"]["instances"] if item["instanceId"] == "django__django-11141")
    assert inst["FAIL_TO_PASS"] == [DOC_LOADED], inst["FAIL_TO_PASS"]
    mapped, missing = evaluate.resolve_test_ids(inst["FAIL_TO_PASS"], evaluate.test_id_map(tasks))
    assert missing == [], missing
    assert mapped == [NAMESPACE], mapped
    ignored = "Migration directories without an __init__.py file are ignored."
    ignored_mapped, ignored_missing = evaluate.resolve_test_ids([ignored], evaluate.test_id_map(tasks))
    assert ignored_missing == []
    assert ignored_mapped == [NAMESPACE]
    unresolved, unresolved_missing = evaluate.resolve_test_ids(["not a published docstring"], {})
    assert unresolved == []
    assert unresolved_missing == ["not a published docstring"]


def test_v5_log_observes_namespace_package():
    log = FIXTURE.read_text(encoding="utf-8")
    assert "Ran 18 tests" in log
    assert "test_loading_namespace_package" not in log
    setup = evaluate.parse_test_output(
        "setup",
        ["migrations.test_loader.RecorderTests.test_apply", NAMESPACE],
        log,
        0,
    )
    assert status_of(setup, "migrations.test_loader.RecorderTests.test_apply") == "pass", setup
    assert status_of(setup, NAMESPACE) == "not-seen", setup
    block = (
        "test_loading_namespace_package (migrations.test_loader.LoaderTests)\n"
        "Migration directories without an __init__.py file are loaded. ... ok\n"
    )
    observed = evaluate.parse_test_output("django__django-11141", [NAMESPACE], log + block, 0)
    assert status_of(observed, NAMESPACE) == "pass", observed
    assert observed["notSeen"] == 0, observed
    docstring = evaluate.parse_test_output("django__django-11141", [DOC_LOADED], log + block, 0)
    assert status_of(docstring, DOC_LOADED) == "pass", docstring
    next_line = (
        "test_loading_namespace_package (migrations.test_loader.LoaderTests)\n"
        "Migration directories without an __init__.py file are loaded.\n"
        "ok\n"
    )
    delayed = evaluate.parse_test_output("django__django-11141", [DOC_LOADED, NAMESPACE], next_line, 0)
    assert status_of(delayed, DOC_LOADED) == "pass", delayed
    assert status_of(delayed, NAMESPACE) == "pass", delayed


def test_setup_labels_include_namespace_package():
    proc = subprocess.run(
        ["bash", "-c", 'source "$1" && django_pass_to_pass_labels "$2"', "bash", str(KIT / "lib" / "django-venv.sh"), str(KIT / "tasks.json")],
        text=True,
        capture_output=True,
        check=True,
    )
    labels = proc.stdout.splitlines()
    assert NAMESPACE in labels, labels
    assert labels.count(NAMESPACE) == 1, labels


def main():
    test_map_keeps_published_ids()
    test_v5_log_observes_namespace_package()
    test_setup_labels_include_namespace_package()
    print("v5 regressions ok")


if __name__ == "__main__":
    main()
