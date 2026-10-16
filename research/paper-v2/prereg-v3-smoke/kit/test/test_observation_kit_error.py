#!/usr/bin/env python3
"""零筆測試、測試 patch 沒套上、或分母沒被觀察到時，整輪是 invalid；缺證據的遺失數維持 null。"""
import json
import os
import stat
import subprocess
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(KIT / "bin"))
import evaluate  # noqa: E402


def git(cwd, *args):
    subprocess.run(["/usr/bin/git", *args], cwd=cwd, check=True, text=True, capture_output=True)


def write_landed_session(arm, slot):
    session = arm / f"session-{slot}"
    session.mkdir(parents=True)
    patch = "diff --git a/shared.py b/shared.py\n--- a/shared.py\n+++ b/shared.py\n@@ -1,1 +1,1 @@\n alpha\n"
    (session / "intended.patch").write_text(patch, encoding="utf-8")
    (session / "prompt.txt").write_text("fixture\n", encoding="utf-8")
    (session / "exit-code").write_text("0\n", encoding="utf-8")
    (session / "stdout.jsonl").write_text("{}\n", encoding="utf-8")


def test_policy_nulls_unobserved_denominators():
    unseen = {
        "tests": [
            {"label": "f2p.one", "status": "not-seen"},
            {"label": "ptp.one", "status": "not-seen"},
        ],
        "passed": 0,
        "failed": 0,
        "notSeen": 2,
    }
    scored = evaluate.apply_observation_policy(unseen, ["f2p.one"], ["ptp.one"])
    assert scored["kitError"] == "tests-unobserved", scored
    assert scored["passed"] is None and scored["failed"] is None and scored["notSeen"] is None
    assert scored["failToPass"]["denominator"] is None
    assert scored["passToPass"]["denominator"] is None

    partial = {
        "tests": [
            {"label": "f2p.one", "status": "pass"},
            {"label": "ptp.one", "status": "not-seen"},
        ],
        "passed": 1,
        "failed": 0,
        "notSeen": 1,
    }
    partial_scored = evaluate.apply_observation_policy(partial, ["f2p.one"], ["ptp.one"])
    assert partial_scored["kitError"] == "denominator-unobserved", partial_scored
    assert partial_scored["passToPass"]["denominator"] is None

    unpatched = {
        "tests": [{"label": "f2p.one", "status": "pass"}],
        "passed": 1,
        "failed": 0,
        "notSeen": 0,
        "testPatchApplied": False,
    }
    unpatched_scored = evaluate.apply_observation_policy(unpatched, ["f2p.one"], [])
    assert unpatched_scored["kitError"] == "test-patch-not-applied", unpatched_scored
    assert unpatched_scored["passed"] is None
    assert unpatched_scored["failToPass"]["denominator"] is None

    empty = {"tests": [], "passed": 0, "failed": 0, "notSeen": 0}
    empty_scored = evaluate.apply_observation_policy(empty, [], [])
    assert empty_scored["kitError"] is None, empty_scored
    assert empty_scored["failToPass"]["denominator"] == 0


def run_evaluate(root, env_text):
    (root / "env.sh").write_text(env_text, encoding="utf-8")
    proc = subprocess.run(
        ["python3", str(KIT / "bin" / "evaluate.py")],
        cwd=root,
        text=True,
        capture_output=True,
        env={**os.environ, "PREREG_SMOKE_STATE": str(root)},
    )
    payload = json.loads((root / "results.json").read_text(encoding="utf-8"))
    return proc.returncode, payload


def test_zero_tests_invalidate_without_nulling_missing_arm():
    root = Path(tempfile.mkdtemp())
    template = root / "template"
    template.mkdir()
    (template / "shared.py").write_text("alpha\n", encoding="utf-8")
    git(template, "init", "-q")
    git(template, "add", "shared.py")
    git(template, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "base")
    base = subprocess.run(["/usr/bin/git", "-C", str(template), "rev-parse", "HEAD"], check=True, text=True, capture_output=True).stdout.strip()
    tasks = {
        "primary": {
            "instances": [
                {
                    "instanceId": "fixture-session-one",
                    "problemStatement": "one",
                    "FAIL_TO_PASS": ["fixture.tests.MarkerTests.test_session_one"],
                    "PASS_TO_PASS": ["fixture.tests.MarkerTests.test_untouched"],
                },
                {"instanceId": "fixture-session-two", "problemStatement": "two", "FAIL_TO_PASS": [], "PASS_TO_PASS": []},
            ]
        }
    }
    (root / "tasks.json").write_text(json.dumps(tasks), encoding="utf-8")
    arm = root / "arm-a"
    work = arm / "work"
    subprocess.run(["/usr/bin/git", "clone", "--quiet", str(template), str(work)], check=True)
    write_landed_session(arm, 1)
    write_landed_session(arm, 2)
    (arm / "start-skew-ms").write_text("1\n", encoding="utf-8")
    (root / "arm-b" / "session-1").mkdir(parents=True)
    (root / "arm-b" / "session-2").mkdir(parents=True)
    stub = root / "stub-python"
    stub.write_text("#!/bin/sh\necho 'no individual results' >&2\nexit 1\n", encoding="utf-8")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    env = "\n".join([
        f"export KIT_ROOT={root}",
        f"export STATE_ROOT={root}",
        f"export TEMPLATE={template}",
        f"export TASKS_JSON={root / 'tasks.json'}",
        f"export GOLD_ROOT={root}",
        f"export COMMON_BASE={base}",
        "export PREREG_SMOKE_MODE=fixture",
        f"export PREREG_PYTHON={stub}",
        "",
    ])
    code, payload = run_evaluate(root, env)
    assert code == 4, code
    assert payload["status"] == "invalid", payload["status"]
    arm_a = payload["arms"]["A"]
    assert arm_a["status"] == "invalid", arm_a["status"]
    assert arm_a["tests"][0]["kitError"] == "tests-unobserved", arm_a["tests"]
    assert arm_a["tests"][0]["passed"] is None
    assert arm_a["tests"][0]["failToPass"]["denominator"] is None
    assert arm_a["lostEditCount"] == 0, arm_a["lostEditCount"]
    arm_b = payload["arms"]["B"]
    assert arm_b["status"] == "evidence_missing", arm_b["status"]
    assert arm_b["lostEditCount"] is None, arm_b["lostEditCount"]
    assert arm_b["silentLostEditCount"] is None


def test_unapplied_patch_is_kit_error():
    root = Path(tempfile.mkdtemp())
    template = root / "template"
    template.mkdir()
    (template / "shared.py").write_text("alpha\n", encoding="utf-8")
    git(template, "init", "-q")
    git(template, "add", "shared.py")
    git(template, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "base")
    base = subprocess.run(["/usr/bin/git", "-C", str(template), "rev-parse", "HEAD"], check=True, text=True, capture_output=True).stdout.strip()
    gold = root / "gold"
    gold.mkdir()
    (gold / "nope.patch").write_text(
        "diff --git a/missing.py b/missing.py\n--- a/missing.py\n+++ b/missing.py\n@@ -1 +1 @@\n-nope\n+nope2\n",
        encoding="utf-8",
    )
    tasks = {
        "primary": {
            "instances": [
                {
                    "instanceId": "django__django-11141",
                    "problemStatement": "one",
                    "FAIL_TO_PASS": ["test_loader (migrations.test_loader.LoaderTests)"],
                    "PASS_TO_PASS": ["test_ok (migrations.test_loader.LoaderTests)"],
                    "testPatch": "gold/nope.patch",
                },
                {
                    "instanceId": "django__django-13820",
                    "problemStatement": "two",
                    "FAIL_TO_PASS": [],
                    "PASS_TO_PASS": [],
                },
            ]
        }
    }
    (root / "tasks.json").write_text(json.dumps(tasks), encoding="utf-8")
    stub = root / "stub-python"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "args = sys.argv[1:]\n"
        "if args[:2] == ['-m', 'pip']:\n"
        "    raise SystemExit(0)\n"
        "sys.stderr.write(\"ModuleNotFoundError: No module named 'django'\\n\")\n"
        "raise SystemExit(1)\n",
        encoding="utf-8",
    )
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    for name in ("arm-a", "arm-b"):
        arm = root / name
        work = arm / "work"
        subprocess.run(["/usr/bin/git", "clone", "--quiet", str(template), str(work)], check=True)
        write_landed_session(arm, 1)
        write_landed_session(arm, 2)
        (arm / "start-skew-ms").write_text("1\n", encoding="utf-8")
    env = "\n".join([
        f"export KIT_ROOT={root}",
        f"export STATE_ROOT={root}",
        f"export TEMPLATE={template}",
        f"export TASKS_JSON={root / 'tasks.json'}",
        f"export GOLD_ROOT={gold}",
        f"export COMMON_BASE={base}",
        "export PREREG_SMOKE_MODE=django",
        f"export PREREG_PYTHON={stub}",
        "",
    ])
    code, payload = run_evaluate(root, env)
    assert code == 4, (code, payload.get("status"))
    assert payload["status"] == "invalid"
    observed = payload["arms"]["A"]["tests"][0]
    assert observed["testPatchApplied"] is False, observed
    assert observed["kitError"] == "test-patch-not-applied", observed
    assert observed["passed"] is None
    assert observed["failToPass"]["denominator"] is None
    assert observed["passToPass"]["denominator"] is None


def test_model_test_edits_reset_before_gold_patch():
    root = Path(tempfile.mkdtemp())
    template = root / "template"
    loader = template / "tests" / "migrations" / "test_loader.py"
    loader.parent.mkdir(parents=True)
    loader.write_text("base\n", encoding="utf-8")
    git(template, "init", "-q")
    git(template, "add", "tests/migrations/test_loader.py")
    git(template, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "base")
    base = subprocess.run(["/usr/bin/git", "-C", str(template), "rev-parse", "HEAD"], check=True, text=True, capture_output=True).stdout.strip()
    gold = root / "gold"
    gold.mkdir()
    (gold / "reset.test.patch").write_text(
        "diff --git a/tests/migrations/test_loader.py b/tests/migrations/test_loader.py\n"
        "--- a/tests/migrations/test_loader.py\n"
        "+++ b/tests/migrations/test_loader.py\n"
        "@@ -1 +1 @@\n"
        "-base\n"
        "+gold\n",
        encoding="utf-8",
    )
    tasks = {
        "primary": {
            "instances": [
                {
                    "instanceId": "django__django-11141",
                    "problemStatement": "one",
                    "FAIL_TO_PASS": ["test_fail (migrations.test_loader.LoaderTests)"],
                    "PASS_TO_PASS": ["test_pass (migrations.test_loader.LoaderTests)"],
                    "testPatch": "gold/reset.test.patch",
                },
                {
                    "instanceId": "django__django-13820",
                    "problemStatement": "two",
                    "FAIL_TO_PASS": [],
                    "PASS_TO_PASS": [],
                },
            ]
        }
    }
    (root / "tasks.json").write_text(json.dumps(tasks), encoding="utf-8")
    argv_path = root / "argv.txt"
    stub = root / "stub-python"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "from pathlib import Path\n"
        "args = sys.argv[1:]\n"
        "if args[:2] == ['-m', 'pip']:\n"
        "    raise SystemExit(0)\n"
        "if '--parallel' not in sys.argv or sys.argv[sys.argv.index('--parallel') + 1] != '1':\n"
        "    sys.stderr.write('expected --parallel 1\\n')\n"
        "    raise SystemExit(2)\n"
        f"Path({str(argv_path)!r}).write_text('\\n'.join(sys.argv), encoding='utf-8')\n"
        "text = Path('tests/migrations/test_loader.py').read_text(encoding='utf-8')\n"
        "if text != 'gold\\n':\n"
        "    sys.stderr.write('test file was not reset to base before the gold patch: ' + text)\n"
        "    raise SystemExit(3)\n"
        "sys.stdout.write('migrations.test_loader.LoaderTests.test_fail ... ok\\n')\n"
        "sys.stdout.write('migrations.test_loader.LoaderTests.test_pass ... ok\\n')\n"
        "raise SystemExit(0)\n",
        encoding="utf-8",
    )
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    for name in ("arm-a", "arm-b"):
        arm = root / name
        work = arm / "work"
        subprocess.run(["/usr/bin/git", "clone", "--quiet", str(template), str(work)], check=True)
        (work / "tests" / "migrations" / "test_loader.py").write_text("model\n", encoding="utf-8")
        git(work, "add", "tests/migrations/test_loader.py")
        git(work, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "model test edit")
        write_landed_session(arm, 1)
        write_landed_session(arm, 2)
        (arm / "start-skew-ms").write_text("1\n", encoding="utf-8")
    env = "\n".join([
        f"export KIT_ROOT={root}",
        f"export STATE_ROOT={root}",
        f"export TEMPLATE={template}",
        f"export TASKS_JSON={root / 'tasks.json'}",
        f"export GOLD_ROOT={gold}",
        f"export COMMON_BASE={base}",
        "export PREREG_SMOKE_MODE=django",
        f"export PREREG_PYTHON={stub}",
        "",
    ])
    code, payload = run_evaluate(root, env)
    assert code == 0, (code, payload.get("status"), (root / "results.json").read_text()[:800])
    observed = payload["arms"]["A"]["tests"][0]
    assert observed["testPatchApplied"] is True, observed
    assert observed["modelTestEditsDiscarded"] is True, observed
    assert observed["discardedModelTestFiles"] == ["tests/migrations/test_loader.py"], observed
    assert observed["resetTestPatchPaths"] == ["tests/migrations/test_loader.py"], observed
    assert observed["kitError"] is None, observed
    argv = argv_path.read_text(encoding="utf-8")
    assert "--parallel" in argv and "1" in argv.split(), argv


def main():
    test_policy_nulls_unobserved_denominators()
    test_zero_tests_invalidate_without_nulling_missing_arm()
    test_unapplied_patch_is_kit_error()
    test_model_test_edits_reset_before_gold_patch()
    print("observation kit-error ok")


if __name__ == "__main__":
    main()
