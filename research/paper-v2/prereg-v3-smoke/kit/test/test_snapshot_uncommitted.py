#!/usr/bin/env python3
"""Arm A 未提交的修改必須進入同一份快照：測試複本與 final.diff 都看得到。

index.lock 只算真正失敗的 git add/commit。重送次數來自命令紀錄，拒絕另計。
"""
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

V6 = KIT.parent / "2026-10-17-codex-v6"
MARKER = "UNCOMMITTED-ARM-A"


def git(cwd, *args):
    subprocess.run(["/usr/bin/git", *args], cwd=cwd, check=True, text=True, capture_output=True)


def command_event(item_id, command, exit_code, output=""):
    item = {
        "id": item_id,
        "type": "command_execution",
        "command": command,
        "aggregated_output": output,
        "exit_code": exit_code,
        "status": "completed" if exit_code == 0 else "failed",
    }
    return json.dumps({"type": "item.completed", "item": item})


def test_duplicate_line_is_low_confidence():
    """同一行已在檔裡時，行文字比對會當成落地。hunk 對不上就標低信心，不把它算成高信心遺失。"""
    patch = (
        "diff --git a/shared.py b/shared.py\n"
        "--- a/shared.py\n"
        "+++ b/shared.py\n"
        "@@ -1,2 +1,3 @@\n"
        " beta\n"
        "+beta\n"
        " keep\n"
    )
    final = "beta\nkeep\n"
    crude = evaluate.missing_edit_lines(patch, final, "")
    assert crude == [], crude
    assert evaluate.hunk_present(final, evaluate.structured_hunks(patch)[0]) is False
    missing, confidence = evaluate.score_patch_lines(patch, final, "")
    assert confidence == "low", confidence
    assert missing == [], missing
    landed = "beta\nbeta\nkeep\n"
    missing, confidence = evaluate.score_patch_lines(patch, landed, "")
    assert missing == [], missing
    assert confidence == "hunk"


def test_hunk_attribution_ignores_other_session():
    intended_early = (
        "diff --git a/shared.py b/shared.py\n"
        "--- a/shared.py\n"
        "+++ b/shared.py\n"
        "@@ -1,2 +1,3 @@\n"
        " alpha\n"
        "+early\n"
        " keep\n"
    )
    intended_late = (
        "diff --git a/shared.py b/shared.py\n"
        "--- a/shared.py\n"
        "+++ b/shared.py\n"
        "@@ -80,2 +80,3 @@\n"
        " tail\n"
        "+late\n"
        " end\n"
    )
    command = (
        "cat > /tmp/p.diff <<'PATCH'\n"
        "diff --git a/shared.py b/shared.py\n"
        "--- a/shared.py\n"
        "+++ b/shared.py\n"
        "@@ -80,2 +80,3 @@\n"
        " tail\n"
        "+late\n"
        " end\n"
        "PATCH\n"
        "/kit/bin/atm-write shared.py /tmp/p.diff"
    )
    stdout = command_event("item_1", command, 3, '{"ok": false, "decision": "rejected-by-design"}\n') + "\n"
    rows = [{
        "decision": "rejected-by-design",
        "terminal": "blocked",
        "reasonCode": "patch-context-mismatch",
        "file": "shared.py",
    }]
    early, early_conf = evaluate.rejection_for_session(rows, ["shared.py"], {"shared.py": intended_early}, stdout)
    late, late_conf = evaluate.rejection_for_session(rows, ["shared.py"], {"shared.py": intended_late}, stdout)
    assert early is False, early
    assert late is True, late
    assert early_conf == "hunk" and late_conf == "hunk"


def test_index_lock_ignores_prose_and_counts_git_failures():
    prose = command_event("item_1", "/bin/bash -lc 'git status --short'", 0, "ok\n")
    prose += "\n" + json.dumps({
        "type": "item.completed",
        "item": {"id": "item_2", "type": "agent_message", "text": "cannot create .git/index.lock because it is read-only"},
    })
    assert evaluate.index_lock_count(prose) == 0
    assert evaluate.index_lock_count("") is None
    assert evaluate.index_lock_count("{}\n") is None
    failed = command_event(
        "item_3",
        "/bin/bash -lc 'git add loader.py && git commit -m fix'",
        1,
        "fatal: Unable to create '/repo/.git/index.lock': Read-only file system\n",
    )
    assert evaluate.index_lock_count(failed) == 1


def test_v6_archive_counts():
    assert evaluate.resubmission_count(V6 / "logs/arm-b") == 3
    for slot in (1, 2):
        text = (V6 / "logs/arm-a/session-{0}/stdout.jsonl".format(slot)).read_text(encoding="utf-8", errors="replace")
        assert evaluate.index_lock_count(text) == 0, slot
        assert "index.lock" in text
    rows = [
        json.loads(line)
        for line in (V6 / "logs/arm-b/steward-writes.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    rejected = sum(1 for row in rows if row.get("terminal") not in (None, "committed"))
    assert rejected == 4, rejected
    assert evaluate.resubmission_count(V6 / "logs/arm-a") == 0


def write_sessions(arm, patch, stdout):
    for slot in (1, 2):
        session = arm / f"session-{slot}"
        session.mkdir(parents=True)
        (session / "intended.patch").write_text(patch, encoding="utf-8")
        (session / "prompt.txt").write_text("fixture\n", encoding="utf-8")
        (session / "exit-code").write_text("0\n", encoding="utf-8")
        (session / "stdout.jsonl").write_text(stdout, encoding="utf-8")


def intended_patch():
    return (
        "diff --git a/shared.py b/shared.py\n"
        "--- a/shared.py\n"
        "+++ b/shared.py\n"
        "@@ -1 +1,2 @@\n"
        " alpha\n"
        "+beta-from-a\n"
        "diff --git a/marker.txt b/marker.txt\n"
        "new file mode 100644\n"
        "--- /dev/null\n"
        "+++ b/marker.txt\n"
        "@@ -0,0 +1 @@\n"
        f"+{MARKER}\n"
    )


def build_tree():
    root = Path(tempfile.mkdtemp())
    template = root / "template"
    template.mkdir()
    (template / "shared.py").write_text("alpha\n", encoding="utf-8")
    (template / "runtests.py").write_text(
        "#!/usr/bin/env python3\n"
        "from pathlib import Path\n"
        f"text = Path('marker.txt').read_text(encoding='utf-8')\n"
        f"status = 'ok' if {MARKER!r} in text else 'FAIL'\n"
        "print(f'test_marker (fixture.Marker) ... {status}')\n"
        "print(text)\n"
        "raise SystemExit(0 if status == 'ok' else 1)\n",
        encoding="utf-8",
    )
    git(template, "init", "-q")
    git(template, "add", "shared.py", "runtests.py")
    git(template, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "base")
    base = subprocess.run(
        ["/usr/bin/git", "-C", str(template), "rev-parse", "HEAD"],
        check=True, text=True, capture_output=True,
    ).stdout.strip()
    tasks = {
        "primary": {
            "instances": [
                {
                    "instanceId": "fixture-session-one",
                    "problemStatement": "one",
                    "FAIL_TO_PASS": ["test_marker (fixture.Marker)"],
                    "PASS_TO_PASS": [],
                },
                {"instanceId": "fixture-session-two", "problemStatement": "two", "FAIL_TO_PASS": [], "PASS_TO_PASS": []},
            ]
        }
    }
    (root / "tasks.json").write_text(json.dumps(tasks), encoding="utf-8")
    prose = command_event("item_1", "/bin/bash -lc 'git status --short && git diff'", 0, "") + "\n"
    prose += json.dumps({
        "type": "item.completed",
        "item": {"id": "item_2", "type": "agent_message", "text": "Git could not create .git/index.lock; the index is read-only."},
    }) + "\n"
    for name in ("arm-a", "arm-b"):
        arm = root / name
        work = arm / "work"
        subprocess.run(["/usr/bin/git", "clone", "--quiet", str(template), str(work)], check=True)
        (work / "shared.py").write_text("alpha\nbeta-from-a\n", encoding="utf-8")
        (work / "marker.txt").write_text(MARKER + "\n", encoding="utf-8")
        smoke = work / ".prereg-smoke"
        smoke.mkdir()
        (smoke / "note.txt").write_text("not-a-task-edit\n", encoding="utf-8")
        if name == "arm-b":
            git(work, "add", "shared.py", "marker.txt")
            git(work, "-c", "user.name=prereg", "-c", "user.email=prereg@localhost", "commit", "-q", "-m", "arm b commit")
        write_sessions(arm, intended_patch(), prose)
        (arm / "start-skew-ms").write_text("1\n", encoding="utf-8")
    env = "\n".join([
        f"export KIT_ROOT={KIT}",
        f"export STATE_ROOT={root}",
        f"export TEMPLATE={template}",
        f"export TASKS_JSON={root / 'tasks.json'}",
        f"export GOLD_ROOT={KIT / 'fixture'}",
        f"export COMMON_BASE={base}",
        "export PREREG_SMOKE_MODE=fixture",
        "export PREREG_PYTHON=python3",
        "",
    ])
    (root / "env.sh").write_text(env, encoding="utf-8")
    return root, base


def run_evaluate(root):
    proc = subprocess.run(
        ["python3", str(KIT / "bin" / "evaluate.py")],
        cwd=root,
        text=True,
        capture_output=True,
        env={**os.environ, "PREREG_SMOKE_STATE": str(root)},
    )
    payload = json.loads((root / "results.json").read_text(encoding="utf-8"))
    return proc, payload


def test_uncommitted_arm_a_is_in_tests_and_diff():
    root, base = build_tree()
    proc, payload = run_evaluate(root)
    assert proc.returncode == 0, (proc.returncode, proc.stderr[-800:], proc.stdout[-800:])
    arm = payload["arms"]["A"]
    assert arm["snapshotCreated"] is True, arm.get("snapshotCreated")
    assert arm["snapshot"] != base
    assert arm["indexLockCount"] == 0, arm["indexLockCount"]
    assert arm["lostEditCount"] == 0, arm
    assert arm["lostEditConfidence"] == "hunk", arm["lostEditConfidence"]
    diff = (root / "arm-a" / "final.diff").read_text(encoding="utf-8")
    assert MARKER in diff, diff
    assert "beta-from-a" in diff, diff
    assert "not-a-task-edit" not in diff
    assert "prereg evaluator snapshot" in (root / "arm-a" / "git-log.txt").read_text(encoding="utf-8")
    observed = arm["tests"][0]
    assert observed["passed"] == 1, observed
    assert MARKER in observed["outputTail"], observed["outputTail"]
    clone = Path(tempfile.mkdtemp()) / "tree"
    evaluate.checkout_snapshot(root / "arm-a" / "work", clone)
    assert MARKER in (clone / "marker.txt").read_text(encoding="utf-8")
    assert "beta-from-a" in (clone / "shared.py").read_text(encoding="utf-8")
    other = payload["arms"]["B"]
    assert other["snapshotCreated"] is True
    assert "prereg evaluator snapshot" in (root / "arm-b" / "git-log.txt").read_text(encoding="utf-8")
    assert MARKER in (root / "arm-b" / "final.diff").read_text(encoding="utf-8")


def test_snapshot_failure_overrides_blocked():
    """本來會是 blocked 的臂，快照寫不進去時必須是 invalid，不能留在 blocked。"""
    root, _base = build_tree()
    work = root / "arm-b" / "work"
    (work / "shared.py").write_text("alpha\nbeta-from-a\nstill-dirty\n", encoding="utf-8")
    smoke = work / ".prereg-smoke"
    smoke.mkdir(exist_ok=True)
    row = {
        "ok": False,
        "decision": "rejected-by-design",
        "reasonCode": "patch-context-mismatch",
        "terminal": "blocked",
        "file": "shared.py",
        "attempt": 1,
    }
    (smoke / "steward-writes.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    git_dir = work / ".git"
    mode = git_dir.stat().st_mode
    git_dir.chmod(mode & ~stat.S_IWUSR & ~stat.S_IWGRP & ~stat.S_IWOTH)
    try:
        proc, payload = run_evaluate(root)
    finally:
        git_dir.chmod(mode)
    assert proc.returncode == 4, (proc.returncode, proc.stderr[-500:], payload.get("status"))
    assert payload["status"] == "invalid", payload["status"]
    arm = payload["arms"]["B"]
    assert arm["status"] == "invalid", arm["status"]
    assert arm["snapshotCreated"] is False
    assert arm["tests"][0]["kitError"] == "evaluator-snapshot-failed", arm["tests"]
    assert not (root / "arm-b" / "final.diff").exists()


def test_snapshot_failure_is_invalid():
    root, _base = build_tree()
    git_dir = root / "arm-a" / "work" / ".git"
    mode = git_dir.stat().st_mode
    git_dir.chmod(mode & ~stat.S_IWUSR & ~stat.S_IWGRP & ~stat.S_IWOTH)
    try:
        proc, payload = run_evaluate(root)
    finally:
        git_dir.chmod(mode)
    assert proc.returncode == 4, (proc.returncode, proc.stderr[-500:], payload.get("status"))
    arm = payload["arms"]["A"]
    assert arm["status"] == "invalid", arm["status"]
    assert arm["tests"][0]["kitError"] == "evaluator-snapshot-failed", arm["tests"]
    assert not (root / "arm-a" / "final.diff").exists()


def main():
    test_duplicate_line_is_low_confidence()
    test_hunk_attribution_ignores_other_session()
    test_index_lock_ignores_prose_and_counts_git_failures()
    test_v6_archive_counts()
    test_uncommitted_arm_a_is_in_tests_and_diff()
    test_snapshot_failure_overrides_blocked()
    test_snapshot_failure_is_invalid()
    print("snapshot uncommitted ok")


if __name__ == "__main__":
    main()
