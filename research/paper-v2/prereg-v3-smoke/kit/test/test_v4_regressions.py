#!/usr/bin/env python3
"""v4 真實 log 與最終樹的回歸。封存是 INVALID，這裡只拿原始輸出當套件測試，不當結果。"""
import hashlib
import json
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
    KIT / "gold" / "django__django-11141.common-base.test.patch",
)
UPSTREAM_11141 = KIT / "gold" / "django__django-11141.test.patch"
REBASED_11141 = GOLD[1]
UPSTREAM_SHA256 = "2368754a38055f10014bbcf18e23e95bbe26b0785de064f4fc561f6c3a03749f"
REBASED_SHA256 = "c87a6bde8ecd0c27257bee336f858434490becbe969c4ba104c269b212b8190d"
TOUCHED_TEST_SHA256 = "d4f185d9b25bf60db2ab78522a76cd016dc9f50baed8ae46dfeb03278177adda"
INIT_SHA256 = "a2e4d044ee2145198980a4f5fc7c3ac93522d3c71a6dbfd506656736705b49f9"
# Whole-file differences that already exist on the common base, outside the touched test.
FILE_DIFFS = (
    (
        '        self.assertEqual(\n'
        '            [x for x, y in author_state.fields],\n'
        '            ["id", "name", "slug", "age", "rating"]\n'
        '        )',
        '        self.assertEqual(\n'
        '            list(author_state.fields),\n'
        '            ["id", "name", "slug", "age", "rating"]\n'
        '        )',
    ),
    (
        '        self.assertEqual(\n'
        '            [x for x, y in book_state.fields],\n'
        '            ["id", "author"]\n'
        '        )',
        "        self.assertEqual(list(book_state.fields), ['id', 'author'])",
    ),
    (
        '        self.assertEqual(\n'
        '            [x for x, y in book_state.fields],\n'
        '            ["id", "user"]\n'
        '        )',
        "        self.assertEqual(list(book_state.fields), ['id', 'user'])",
    ),
)
FAIL_TO_PASS = ["Migration directories without an __init__.py file are loaded."]
PASS_TO_PASS = [
    "test_apply (migrations.test_loader.RecorderTests)",
    "test_invalid (migrations.test_loader.PycLoaderTests)",
    "test_valid (migrations.test_loader.PycLoaderTests)",
    "test_check_consistent_history (migrations.test_loader.LoaderTests)",
    "test_check_consistent_history_squashed (migrations.test_loader.LoaderTests)",
    "test_explicit_missing_module (migrations.test_loader.LoaderTests)",
    "test_first (migrations.test_loader.LoaderTests)",
    "Files prefixed with underscore, tilde, or dot aren't loaded.",
    "test_load (migrations.test_loader.LoaderTests)",
    "test_load_empty_dir (migrations.test_loader.LoaderTests)",
    "test_load_import_error (migrations.test_loader.LoaderTests)",
    "test_load_module_file (migrations.test_loader.LoaderTests)",
    "test_load_unmigrated_dependency (migrations.test_loader.LoaderTests)",
    "Tests loading a squashed migration",
    "Tests loading a complex set of squashed migrations",
    "test_loading_squashed_complex_multi_apps (migrations.test_loader.LoaderTests)",
    "test_loading_squashed_complex_multi_apps_partially_applied (migrations.test_loader.LoaderTests)",
    "Tests loading a complex but erroneous set of squashed migrations",
    "Tests loading a squashed migration with a new migration referencing it",
    "test_marked_as_migrated (migrations.test_loader.LoaderTests)",
    "test_marked_as_unmigrated (migrations.test_loader.LoaderTests)",
    "Tests prefix name matching",
    "test_plan_handles_repeated_migrations (migrations.test_loader.LoaderTests)",
    "test_run_before (migrations.test_loader.LoaderTests)",
]
DJANGO_TEST = re.compile(r"^test_\S+ \(.+\)$")


def git(cwd, *args, check=True):
    result = subprocess.run(["/usr/bin/git", *args], cwd=cwd, text=True, capture_output=True)
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr)
    return result


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def apply_to_files(files, patch):
    root = Path(tempfile.mkdtemp())
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "base")
    applied = git(root, "apply", str(patch), check=False)
    if applied.returncode != 0:
        raise RuntimeError(applied.stderr)
    out = {}
    for path in root.rglob("*"):
        if path.is_file() and ".git" not in path.parts:
            out[str(path.relative_to(root))] = path.read_bytes()
    return out


def method_text(source, name):
    lines = source.splitlines(keepends=True)
    start = next(i for i, line in enumerate(lines) if line.startswith(f"    def {name}("))
    end = len(lines)
    for index in range(start + 1, len(lines)):
        if lines[index].startswith("    def ") or lines[index].startswith("class "):
            end = index
            break
    return "".join(lines[start:end])


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


def test_11141_rebased_patch_matches_upstream_post_patch():
    assert sha256(UPSTREAM_11141.read_bytes()) == UPSTREAM_SHA256
    assert sha256(REBASED_11141.read_bytes()) == REBASED_SHA256
    tasks = json.loads((KIT / "tasks.json").read_text(encoding="utf-8"))
    instance = next(item for item in tasks["primary"]["instances"] if item["instanceId"] == "django__django-11141")
    assert instance["testPatch"] == "gold/django__django-11141.common-base.test.patch"
    assert instance["upstreamTestPatch"] == "gold/django__django-11141.test.patch"
    assert instance["FAIL_TO_PASS"] == FAIL_TO_PASS
    assert instance["PASS_TO_PASS"] == PASS_TO_PASS

    own_base = FIX / "upstream-own-base" / "tests" / "migrations" / "test_loader.py"
    common = FIX / "base"
    upstream = apply_to_files(
        {"tests/migrations/test_loader.py": own_base.read_bytes()},
        UPSTREAM_11141,
    )
    rebased = apply_to_files(
        {
            "tests/migrations/test_loader.py": (common / "tests/migrations/test_loader.py").read_bytes(),
            "tests/migrations/test_migrations_namespace_package/0001_initial.py": (
                common / "tests/migrations/test_migrations_namespace_package/0001_initial.py"
            ).read_bytes(),
        },
        REBASED_11141,
    )
    loader = "tests/migrations/test_loader.py"
    init = "tests/migrations/test_migrations_namespace_package/0001_initial.py"
    touched = method_text(upstream[loader].decode(), "test_loading_namespace_package")
    assert touched == method_text(rebased[loader].decode(), "test_loading_namespace_package")
    assert sha256(touched.encode()) == TOUCHED_TEST_SHA256
    assert upstream[init] == rebased[init]
    assert sha256(upstream[init]) == INIT_SHA256
    adjusted = upstream[loader].decode()
    for old, new in FILE_DIFFS:
        assert adjusted.count(old) == 1, old
        adjusted = adjusted.replace(old, new, 1)
    assert adjusted.encode() == rebased[loader]


def main():
    test_parser_on_v4_logs()
    test_gold_patches_apply_to_v4_trees()
    test_11141_rebased_patch_matches_upstream_post_patch()
    print("v4 regressions ok")


if __name__ == "__main__":
    main()
