#!/usr/bin/env python3
"""v4 真實 log 與最終樹的回歸。封存是 INVALID，這裡只拿原始輸出當套件測試，不當結果。"""
import re
import subprocess
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(KIT / "bin"))
import evaluate  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures" / "v4"
GOLD = (
    KIT / "gold" / "django__django-13820.test.patch",
    KIT / "gold" / "django__django-11141.test.patch",
)
DJANGO_TEST = re.compile(r"^test_\S+ \(.+\)$")


def git(cwd, *args, check=True):
    result = subprocess.run(["/usr/bin/git", *args], cwd=cwd, text=True, capture_output=True)
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr)
    return result


def django_results(output):
    found = evaluate.parse_verbosity2_results(output)
    return {head: status for head, status in found.items() if DJANGO_TEST.match(head)}


def test_parser_on_v4_logs():
    setup = (FIX / "setup-tests.log").read_text(encoding="utf-8")
    observed = django_results(setup)
    assert len(observed) == 18, sorted(observed)
    assert set(observed.values()) == {"pass"}, observed
    dotted = []
    for head in observed:
        method, _, rest = head.partition(" (")
        cls = rest[:-1]
        dotted.append(f"{cls}.{method}")
    parsed = evaluate.parse_test_output("django__django-13820", dotted, setup, 0)
    assert parsed["notSeen"] == 0, parsed
    assert parsed["passed"] == 18, parsed
    assert parsed["failed"] == 0, parsed

    arm_a = (FIX / "a-13820.tail.txt").read_text(encoding="utf-8")
    assert "Ran 18 tests" in arm_a
    assert "FAILED (failures=1)" in arm_a
    failure = "migrations.test_loader.LoaderTests.test_loading_package_without__file__"
    failed = evaluate.parse_test_output("django__django-13820", [failure], arm_a, 1)
    assert failed["tests"][0]["status"] == "fail", failed
    assert failed["failed"] == 1 and failed["notSeen"] == 0, failed

    arm_b = (FIX / "b-13820.tail.txt").read_text(encoding="utf-8")
    assert "Ran 18 tests" in arm_b and "FAILED (failures=1)" in arm_b
    other = "migrations.test_loader.LoaderTests.test_load_empty_dir"
    other_parsed = evaluate.parse_test_output("django__django-13820", [other], arm_b, 1)
    assert other_parsed["tests"][0]["status"] == "fail", other_parsed
    assert other_parsed["notSeen"] == 0, other_parsed
    # The sealed eval stdout is truncated, so the only complete 18-test raw log is setup-tests.log.
    # Arm B's real FAIL line names one of those tests. Together: 18 observed, that one failed.
    fail_line = next(line for line in arm_b.splitlines() if line.startswith("FAIL: "))
    combined = django_results(setup + "\n" + fail_line + "\n")
    assert len(combined) == 18, sorted(combined)
    assert combined["test_load_empty_dir (migrations.test_loader.LoaderTests)"] == "fail"
    assert sum(status == "pass" for status in combined.values()) == 17


def build_tree(diff_name):
    root = Path(tempfile.mkdtemp())
    source = FIX / "base"
    for path in source.rglob("*"):
        if path.is_file():
            target = root / path.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(path.read_bytes())
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "base")
    base = git(root, "rev-parse", "HEAD").stdout.strip()
    diff = FIX / diff_name
    if diff.stat().st_size:
        applied = git(root, "apply", str(diff), check=False)
        if applied.returncode != 0:
            raise RuntimeError(applied.stderr)
        git(root, "add", "-A")
        git(root, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "final")
    return root, base


def test_gold_patches_apply_to_v4_trees():
    for diff_name in ("arm-a.diff", "arm-b.diff"):
        for patch in GOLD:
            root, base = build_tree(diff_name)
            text = patch.read_text(encoding="utf-8")
            reset_paths, discarded = evaluate.discard_model_test_edits(root, base, text)
            applied = evaluate.apply_gold_test_patch(root, patch)
            assert applied.returncode == 0, (diff_name, patch.name, applied.stderr)
            assert "tests/migrations/test_loader.py" in reset_paths, (diff_name, patch.name, reset_paths)
            if diff_name == "arm-b.diff":
                assert discarded == ["tests/migrations/test_loader.py"], (patch.name, discarded)
            else:
                assert discarded == [], (patch.name, discarded)
            loaded = (root / "tests/migrations/test_loader.py").read_text(encoding="utf-8")
            if patch.name.startswith("django__django-11141"):
                assert loaded.count("def test_loading_namespace_package") == 1, patch.name
                assert "are loaded" in loaded
            else:
                assert "def test_loading_package_without__file__" in loaded
                assert "are ignored" in loaded


def main():
    test_parser_on_v4_logs()
    test_gold_patches_apply_to_v4_trees()
    print("v4 regressions ok")


if __name__ == "__main__":
    main()
