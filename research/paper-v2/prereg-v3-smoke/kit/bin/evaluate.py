#!/usr/bin/env python3
"""Score one smoke run. Writes results.json. Exploratory; no win claim."""
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

def resolve_state():
    if os.environ.get("PREREG_SMOKE_STATE"):
        return Path(os.environ["PREREG_SMOKE_STATE"])
    kit = Path(__file__).resolve().parents[1]
    current = kit / "state" / "CURRENT"
    if current.is_file():
        selected = current.read_text(encoding="utf-8").strip()
        if selected:
            return Path(selected)
    return kit / "state"


STATE = resolve_state()
ENV = STATE / "env.sh"
# Codex 0.159.2 and 0.163.0 reserve these workspace directories under workspace-write.
# unix-user pre-creates them for the session. They are not task edits.
CODEX_RUNTIME_DIRS = (".agents", ".codex", ".aws")


def is_codex_runtime_path(path):
    return any(part in CODEX_RUNTIME_DIRS for part in Path(path).parts)


def read_env():
    values = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("export "):
            key, _, raw = line[len("export "):].partition("=")
            values[key] = raw.strip().strip("'")
    return values


def git(cwd, *args, check=True, input_text=None):
    result = subprocess.run(
        ["/usr/bin/git", *args],
        cwd=cwd,
        input=input_text,
        text=True,
        capture_output=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr}")
    return result


def added_lines(patch_text):
    added = []
    for line in patch_text.splitlines():
        if line.startswith("+++") or line.startswith("---") or line.startswith("diff "):
            continue
        if line.startswith("+"):
            added.append(line[1:])
    return added


def removed_lines(patch_text):
    removed = []
    for line in patch_text.splitlines():
        if line.startswith("+++") or line.startswith("---") or line.startswith("diff "):
            continue
        if line.startswith("-"):
            removed.append(line[1:])
    return removed


def missing_edit_lines(patch_text, final_text, final_diff_text):
    """意圖修改對照最終 diff。新增行不在最終檔，或刪除行仍留在最終檔且 diff 沒有刪掉它，都算沒落地。"""
    final_lines = set(final_text.splitlines())
    missing = [line for line in added_lines(patch_text) if line not in final_lines]
    deleted_in_final = set(removed_lines(final_diff_text))
    for line in removed_lines(patch_text):
        if line in final_lines and line not in deleted_in_final:
            missing.append(line)
    return missing


def split_patch(text):
    parts = {}
    chunks = re.split(r"(?=^diff --git )", text, flags=re.M)
    for chunk in chunks:
        match = re.match(r"diff --git a/.+ b/(.+)", chunk)
        if match:
            parts[match.group(1).strip()] = chunk if chunk.endswith("\n") else chunk + "\n"
    return parts


def apply_to_text(base_text, patch_text):
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "target"
        target.write_text(base_text, encoding="utf-8")
        patch = Path(directory) / "p.diff"
        normalised = re.sub(r"^diff --git a/\S+ b/\S+\n", "diff --git a/target b/target\n", patch_text, count=1, flags=re.M)
        normalised = re.sub(r"^--- a/\S+\n", "--- a/target\n", normalised, count=1, flags=re.M)
        normalised = re.sub(r"^\+\+\+ b/\S+\n", "+++ b/target\n", normalised, count=1, flags=re.M)
        patch.write_text(normalised, encoding="utf-8")
        result = subprocess.run(["/usr/bin/git", "apply", "--unsafe-paths", str(patch)], cwd=directory, text=True, capture_output=True)
        if result.returncode != 0:
            return None
        return target.read_text(encoding="utf-8")


def tokens_of(session):
    total = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "events": 0}
    path = session / "stdout.jsonl"
    if not path.exists():
        return total
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        usage = event.get("usage") if isinstance(event, dict) else None
        if not isinstance(usage, dict):
            # codex jsonl sometimes nests usage under a message payload
            blob = json.dumps(event)
            for key in ("input_tokens", "output_tokens", "total_tokens"):
                found = re.search(rf'"{key}"\s*:\s*(\d+)', blob)
                if found:
                    total[key] += int(found.group(1))
                    total["events"] += 1
            continue
        for key in ("input_tokens", "output_tokens", "total_tokens"):
            if isinstance(usage.get(key), int):
                total[key] += usage[key]
        total["events"] += 1
    return total


def steward_rows(work):
    path = work / ".prereg-smoke" / "steward-writes.jsonl"
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def classify_write(row):
    decision = row.get("decision")
    if decision in {"accepted", "rejected-by-design", "kit-error"}:
        return decision
    if row.get("ok") is True and row.get("terminal") == "committed":
        return "accepted"
    reason = str(row.get("reasonCode") or row.get("stopReason") or "").strip()
    if row.get("terminal") in {"blocked", "queued"} and reason:
        return "rejected-by-design"
    return "kit-error"


def blocked_steward_write(row):
    if classify_write(row) == "rejected-by-design":
        return True
    reason = str(row.get("reasonCode") or row.get("stopReason") or "").strip()
    return row.get("terminal") in {"blocked", "queued"} and bool(reason)


def recompose_or_retry(rows):
    """從 steward 紀錄派生。被拒絕的寫入就是一次重寫或重送，即使 retryCount 仍是 0。"""
    total = 0
    for row in rows:
        explicit = int(row.get("retryCount") or 0) + int(row.get("hashDriftCount") or 0) + int((row.get("commit") or {}).get("headMoves") or 0)
        if blocked_steward_write(row):
            total += max(explicit, 1)
        else:
            total += explicit
    return total


def session_rejected(rows, session_files):
    """Steward rows have no session id. taskId/actorId stay prereg / prereg-session for every session.
    A session is rejected when the log has a blocked or rejected write for a file in that session's intended patch.
    """
    files = {path for path in (session_files or []) if path}
    if not files:
        return False
    for row in rows:
        target = row.get("file")
        if target not in files:
            continue
        decision = str(row.get("decision") or "")
        if blocked_steward_write(row) or decision.startswith("rejected") or row.get("terminal") not in (None, "committed"):
            return True
    return False


def evidence_gaps(arm_dir):
    gaps = []
    for slot in (1, 2):
        session = arm_dir / f"session-{slot}"
        intended = session / "intended.patch"
        if not session.is_dir() or not intended.is_file() or intended.stat().st_size == 0:
            gaps.append(slot)
    return gaps


def read_model_record(path):
    if not path.is_file():
        return None, None
    lines = path.read_text(encoding="utf-8").splitlines()
    model = lines[0].strip() if lines else None
    effort = None
    for line in lines[1:]:
        if line.startswith("reasoning_effort="):
            raw = line.split("=", 1)[1].strip()
            effort = raw or None
            break
    return model or None, effort


def arm_model_fields(arm_dir):
    model, effort = read_model_record(arm_dir / "model.txt")
    return {"model": model, "reasoningEffort": effort}


def missing_arm(arm_name, arm_dir, gaps):
    sessions = []
    for slot in (1, 2):
        session = arm_dir / f"session-{slot}"
        sessions.append({
            "slot": slot,
            "evidenceStatus": "evidence_missing" if slot in gaps else "ok",
            "lostEdits": None,
            "keptOrRejected": None,
        })
    fields = arm_model_fields(arm_dir)
    return {
        "arm": arm_name,
        "status": "evidence_missing",
        "work": str(arm_dir / "work"),
        "model": fields["model"],
        "reasoningEffort": fields["reasoningEffort"],
        "sessions": sessions,
        "lostEditCount": None,
        "silentLostEditCount": None,
        "evidenceGaps": gaps,
    }


def read_boundary_file(arm_dir):
    path = arm_dir / "boundary.txt"
    found = {}
    if not path.is_file():
        return found
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        found[key.strip()] = value.strip()
    return found


def score_arm(arm_name, arm_dir, tasks, base):
    gaps = evidence_gaps(arm_dir)
    if gaps:
        return missing_arm(arm_name, arm_dir, gaps)
    work = arm_dir / "work"
    rows = steward_rows(work)
    final_diff_text = git(work, "diff", f"{base}..HEAD", check=False).stdout
    final_parts = split_patch(final_diff_text)
    blocked_files = {row.get("file") for row in rows if row.get("file") and blocked_steward_write(row)}
    sessions = []
    index_lock = 0
    git_errors = []
    for slot in (1, 2):
        session = arm_dir / f"session-{slot}"
        stderr = (session / "stderr.txt").read_text(encoding="utf-8", errors="replace") if (session / "stderr.txt").exists() else ""
        stdout = (session / "stdout.jsonl").read_text(encoding="utf-8", errors="replace") if (session / "stdout.jsonl").exists() else ""
        index_lock += stderr.count("index.lock") + stdout.count("index.lock")
        exit_code = int((session / "exit-code").read_text().strip()) if (session / "exit-code").exists() else None
        if exit_code not in (0, None, 3):
            git_errors.append({"session": slot, "exitCode": exit_code, "stderrTail": stderr[-500:]})
        intended_path = session / "intended.patch"
        lost = []
        kept = []
        parts = split_patch(intended_path.read_text(encoding="utf-8"))
        instance_id = None
        prompt = (session / "prompt.txt").read_text(encoding="utf-8", errors="replace") if (session / "prompt.txt").exists() else ""
        for instance in tasks["primary"]["instances"]:
            if instance["problemStatement"][:80] in prompt or instance["instanceId"] in stdout:
                instance_id = instance["instanceId"]
                break
        if instance_id is None and slot - 1 < len(tasks["primary"]["instances"]):
            instance_id = tasks["primary"]["instances"][slot - 1]["instanceId"]
        rejected = session_rejected(rows, parts.keys())
        unfinished = []
        for file, patch in parts.items():
            if is_codex_runtime_path(file):
                continue
            try:
                base_text = git(work, "show", f"{base}:{file}").stdout
            except RuntimeError:
                base_text = ""
            final = work / file
            final_text = final.read_text(encoding="utf-8") if final.exists() else ""
            missing = missing_edit_lines(patch, final_text, final_parts.get(file, ""))
            item = {"file": file, "missingAddedLines": missing[:12], "missingCount": len(missing)}
            # 被 steward 擋住的意圖修改，只要最終 diff 沒有它，就是未完成，不是沉默遺失。
            blocked = rejected or file in blocked_files
            if missing and not blocked:
                lost.append(item)
                unfinished.append(item)
            elif missing and blocked:
                item["classified"] = "steward-rejected"
                kept.append(item)
                unfinished.append(item)
            else:
                kept.append({"file": file, "missingCount": 0})
        sessions.append({
            "slot": slot,
            "evidenceStatus": "ok",
            "instanceId": instance_id,
            "startedAt": (session / "started-at").read_text().strip() if (session / "started-at").exists() else None,
            "endedAt": (session / "ended-at").read_text().strip() if (session / "ended-at").exists() else None,
            "exitCode": exit_code,
            "tokens": tokens_of(session),
            "lostEdits": lost,
            "unfinishedEdits": unfinished,
            "keptOrRejected": kept,
            "stewardRejected": rejected,
            "quotaStop": (session / "QUOTA_STOP").exists(),
        })
    corruption = []
    for path in work.rglob("*"):
        if not path.is_file() or ".git" in path.parts or "venv" in path.parts:
            continue
        if is_codex_runtime_path(path):
            continue
        if path.suffix not in {".py", ".txt", ".html"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "<<<<<<<" in text and ">>>>>>>" in text:
            corruption.append(str(path.relative_to(work)))
    latencies = [row.get("writeToCommitMs") for row in rows if isinstance(row.get("writeToCommitMs"), int)]
    decisions = [classify_write(row) for row in rows] if arm_name == "B" else []
    unfinished = any(session["unfinishedEdits"] for session in sessions)
    if arm_name == "B" and any(item == "kit-error" for item in decisions):
        status = "invalid"
    elif arm_name == "B" and unfinished:
        status = "blocked"
    else:
        status = "ok"
    labeled = []
    for row in rows:
        item = {key: value for key, value in row.items() if key != "currentFileText"}
        item["decision"] = classify_write(row)
        labeled.append(item)
    boundary = read_boundary_file(arm_dir)
    fields = arm_model_fields(arm_dir)
    return {
        "arm": arm_name,
        "boundary": boundary.get("boundary"),
        "boundaryMechanism": boundary.get("mechanism"),
        "status": status,
        "work": str(work),
        "head": git(work, "rev-parse", "HEAD", check=False).stdout.strip(),
        "startSkewMs": int((arm_dir / "start-skew-ms").read_text().strip()) if (arm_dir / "start-skew-ms").exists() else None,
        "model": fields["model"],
        "reasoningEffort": fields["reasoningEffort"],
        "sessions": sessions,
        "lostEditCount": sum(len(session["lostEdits"]) for session in sessions),
        "silentLostEditCount": sum(len(session["lostEdits"]) for session in sessions),
        "corruption": corruption,
        "indexLockCount": index_lock,
        "gitErrors": git_errors,
        "conflictCount": index_lock + sum(1 for row in rows if row.get("terminal") not in (None, "committed")),
        "resolutionTimeMs": None,
        "steward": {
            "writes": len(rows),
            "rejected": sum(1 for row in rows if row.get("terminal") not in (None, "committed")),
            "recomposeOrRetry": recompose_or_retry(rows),
            "queueWaitMs": [int((row.get("commit") or {}).get("gitIndexLockWaitMs") or 0) for row in rows],
            "writeToCommitMs": latencies,
            "batchSizes": [row.get("batchSize") for row in rows],
            "terminals": [row.get("terminal") for row in rows],
            "decisions": [item["decision"] for item in labeled],
            "reasonCodes": [item.get("reasonCode") for item in labeled],
            "writesDetail": labeled,
        },
    }


def null_score_fields(reason):
    empty = {"denominator": None, "passed": None, "failed": None, "notSeen": None}
    return {
        "kitError": reason,
        "passed": None,
        "failed": None,
        "notSeen": None,
        "failToPass": dict(empty),
        "passToPass": dict(empty),
    }


def group_summary(labels, tests):
    if not labels:
        return {"denominator": 0, "passed": 0, "failed": 0, "notSeen": 0}
    by_label = {item["label"]: item["status"] for item in tests}
    statuses = [by_label.get(label, "not-seen") for label in labels]
    return {
        "denominator": len(labels),
        "passed": sum(1 for status in statuses if status == "pass"),
        "failed": sum(1 for status in statuses if status == "fail"),
        "notSeen": sum(1 for status in statuses if status == "not-seen"),
    }


def observation_kit_error(parsed, fail_labels, pass_labels):
    """零筆觀察、測試 patch 沒套上，或任一組分母完全沒被觀察到，都是 kit-error。空清單不是未觀察。"""
    if parsed.get("kitError"):
        return parsed["kitError"]
    if parsed.get("testPatchApplied") is False:
        return "test-patch-not-applied"
    expected = list(fail_labels or []) + list(pass_labels or [])
    if not expected:
        return None
    tests = parsed.get("tests") or []
    seen = [item for item in tests if item.get("status") in {"pass", "fail"}]
    if not seen:
        return "tests-unobserved"
    for labels in (fail_labels, pass_labels):
        if not labels:
            continue
        summary = group_summary(labels, tests)
        if summary["denominator"] and summary["passed"] == 0 and summary["failed"] == 0:
            return "denominator-unobserved"
    return None


def apply_observation_policy(parsed, fail_labels, pass_labels):
    reason = observation_kit_error(parsed, fail_labels, pass_labels)
    if reason:
        updated = dict(parsed)
        updated.update(null_score_fields(reason))
        return updated
    updated = dict(parsed)
    updated["kitError"] = None
    updated["failToPass"] = group_summary(fail_labels, parsed.get("tests") or [])
    updated["passToPass"] = group_summary(pass_labels, parsed.get("tests") or [])
    return updated


def test_patch_files(patch_text):
    """Every path a test patch touches. created=True means the patch adds the file."""
    files = []
    seen = set()
    for chunk in re.split(r"(?=^diff --git )", patch_text, flags=re.M):
        match = re.match(r"diff --git a/\S+ b/(\S+)", chunk)
        if not match:
            continue
        path = match.group(1)
        if path == "/dev/null" or path in seen:
            continue
        seen.add(path)
        created = re.search(r"^new file mode |^--- /dev/null$", chunk, flags=re.M) is not None
        files.append({"path": path, "created": created})
    return files


def test_patch_paths(patch_text):
    return [item["path"] for item in test_patch_files(patch_text)]


def discard_model_test_edits(clone, base, patch_text):
    """Reset every path the gold test patch touches before an exact git apply.

    Files the patch modifies go back to base. Files the patch creates are deleted,
    including when they already exist at base, so creation does not hit 'already exists'.
    The final tree can contain both tasks' edits to shared files; each task is evaluated
    on its own clone with only its own test patch.
    Returns (reset_paths, discarded_model_edits). reset_paths is every path restored or
    deleted. discarded_model_edits is the subset whose pre-reset content differed from base.
    """
    reset_paths = []
    discarded = []
    clone = str(clone)
    for item in test_patch_files(patch_text):
        path = item["path"]
        target = Path(clone) / path
        diff = subprocess.run(
            ["/usr/bin/git", "-C", clone, "diff", "--quiet", str(base), "--", path],
            capture_output=True,
        )
        differed = diff.returncode != 0
        if item["created"]:
            if target.exists() or target.is_symlink():
                target.unlink()
                reset_paths.append(path)
            if differed and path not in discarded:
                discarded.append(path)
            continue
        checkout = subprocess.run(
            ["/usr/bin/git", "-C", clone, "checkout", "--force", str(base), "--", path],
            text=True,
            capture_output=True,
        )
        if checkout.returncode != 0:
            if target.exists() or target.is_symlink():
                target.unlink()
                differed = True
            else:
                existed = subprocess.run(
                    ["/usr/bin/git", "-C", clone, "cat-file", "-e", f"{base}:{path}"],
                    capture_output=True,
                ).returncode == 0
                if existed:
                    raise RuntimeError(f"git checkout {base} -- {path} failed: {checkout.stderr}")
        reset_paths.append(path)
        if differed:
            discarded.append(path)
    return reset_paths, discarded


def apply_gold_test_patch(clone, test_patch):
    """Apply one task's test patch with git apply only. A mismatch is a kit-error."""
    return subprocess.run(
        ["/usr/bin/git", "-C", str(clone), "apply", str(test_patch)],
        text=True,
        capture_output=True,
    )


def select_django_labels(labels):
    mapped = []
    for label in labels or []:
        if " (" in label or str(label).startswith("test_"):
            match = re.match(r"(.+) \((.+)\)", label)
            mapped.append(f"{match.group(2)}.{match.group(1)}" if match else label)
    return mapped


def install_task_repo(python, repo):
    return subprocess.run(
        [python, "-m", "pip", "install", "-q", "-e", str(repo)],
        text=True,
        capture_output=True,
    )


def run_tests(work, tasks, env, arm_score):
    mode = env.get("PREREG_SMOKE_MODE")
    python = env.get("PREREG_PYTHON") or "python3"
    results = []
    if mode == "fixture":
        for instance in tasks["primary"]["instances"]:
            labels = instance["FAIL_TO_PASS"] + instance["PASS_TO_PASS"]
            proc = subprocess.run([python, "runtests.py", "--verbosity", "2", *labels], cwd=work, text=True, capture_output=True)
            parsed = parse_test_output(instance["instanceId"], labels, proc.stdout + proc.stderr, proc.returncode)
            results.append(apply_observation_policy(parsed, instance["FAIL_TO_PASS"], instance["PASS_TO_PASS"]))
        return results
    gold_root = Path(env["KIT_ROOT"])
    for instance in tasks["primary"]["instances"]:
        fail_labels = select_django_labels(instance["FAIL_TO_PASS"])
        pass_labels = select_django_labels(instance["PASS_TO_PASS"])
        mapped = fail_labels + pass_labels
        if (instance["FAIL_TO_PASS"] or instance["PASS_TO_PASS"]) and not mapped:
            parsed = {
                "instanceId": instance["instanceId"],
                "note": "FAIL_TO_PASS is not a Django test id; see tasks.json",
                "tests": [],
                "exitCode": None,
            }
            results.append(apply_observation_policy(parsed, instance["FAIL_TO_PASS"], instance["PASS_TO_PASS"]))
            continue
        if not mapped:
            results.append({
                "instanceId": instance["instanceId"],
                "note": "FAIL_TO_PASS is not a Django test id; see tasks.json",
                "tests": [],
            })
            continue
        with tempfile.TemporaryDirectory() as scratch:
            clone = Path(scratch) / "tree"
            subprocess.run(["/usr/bin/git", "clone", "--quiet", "--shared", str(work), str(clone)], check=True)
            subprocess.run(["/usr/bin/git", "-C", str(clone), "checkout", "--force", "--detach", "--quiet", "HEAD"], check=True)
            installed = install_task_repo(python, clone)
            if installed.returncode != 0:
                parsed = {
                    "instanceId": instance["instanceId"],
                    "kitError": "django-not-installed",
                    "tests": [],
                    "exitCode": installed.returncode,
                    "installError": (installed.stderr or installed.stdout or "")[-400:],
                    "testPatchApplied": None,
                }
                results.append(apply_observation_policy(parsed, fail_labels, pass_labels))
                continue
            test_patch = gold_root / instance["testPatch"]
            patch_text = test_patch.read_text(encoding="utf-8", errors="replace") if test_patch.is_file() else ""
            base_commit = env.get("COMMON_BASE")
            if patch_text and base_commit:
                reset_paths, discarded = discard_model_test_edits(clone, base_commit, patch_text)
            else:
                reset_paths, discarded = [], []
            applied = apply_gold_test_patch(clone, test_patch)
            if applied.returncode != 0:
                parsed = {
                    "instanceId": instance["instanceId"],
                    "tests": [],
                    "exitCode": applied.returncode,
                    "testPatchApplied": False,
                    "testPatchError": (applied.stderr or "")[-400:],
                    "modelTestEditsDiscarded": bool(discarded),
                    "discardedModelTestFiles": discarded,
                    "resetTestPatchPaths": reset_paths,
                }
                results.append(apply_observation_policy(parsed, fail_labels, pass_labels))
                continue
            env_run = os.environ.copy()
            env_run["PYTHONPATH"] = str(clone) + (os.pathsep + env_run["PYTHONPATH"] if env_run.get("PYTHONPATH") else "")
            proc = subprocess.run(
                [python, "tests/runtests.py", "--verbosity", "2", "--settings=test_sqlite", "--parallel", "1", *mapped],
                cwd=clone,
                text=True,
                capture_output=True,
                env=env_run,
            )
            parsed = parse_test_output(instance["instanceId"], mapped, proc.stdout + proc.stderr, proc.returncode)
            parsed["testPatchApplied"] = True
            parsed["testPatchError"] = None
            parsed["modelTestEditsDiscarded"] = bool(discarded)
            parsed["discardedModelTestFiles"] = discarded
            parsed["resetTestPatchPaths"] = reset_paths
            results.append(apply_observation_policy(parsed, fail_labels, pass_labels))
    arm_score["tests"] = results
    return results


RESULT_LINE = re.compile(
    r"^(?P<head>.*?)\s+\.\.\. (?P<status>ok|FAIL|ERROR|skipped|expected failure|unexpected success)\s*$",
)
STATUS_WORD = r"ok|FAIL|ERROR|skipped|expected failure|unexpected success"
STATUS_ONLY = re.compile(rf"^({STATUS_WORD})$")
FAIL_HEADER = re.compile(r"^(?P<kind>FAIL|ERROR): (?P<head>.+)$")
DJANGO_TEST = re.compile(r"^test_\S+ \(.+\)$")


def _status_name(raw):
    if raw == "ok":
        return "pass"
    if raw in {"FAIL", "ERROR", "unexpected success"}:
        return "fail"
    return "not-seen"


def parse_verbosity2_results(output):
    """Django 3.2 --verbosity 2 prints the test id, then an optional docstring, then '... ok'.
    The docstring can sit on its own line, and a system-check line can push 'ok' onto the next line.
    Failures are also summarized as 'FAIL: test_x (module.Class)' / 'ERROR: ...'.
    """
    found = {}
    pending = None
    # verbosity 1 prints dots plus a FAIL: summary. That summary alone is not a verbosity-2 result.
    verbose = re.search(rf"\.\.\. (?:{STATUS_WORD})\b", output) is not None or re.search(r"(?m)^test_\S+ \(.+\)$", output) is not None
    for raw_line in output.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        fail = FAIL_HEADER.match(stripped)
        if fail and verbose:
            found[fail.group("head").strip()] = "fail"
            if pending == fail.group("head").strip():
                pending = None
            continue
        inline = RESULT_LINE.match(stripped)
        if inline:
            head = inline.group("head").strip()
            status = _status_name(inline.group("status"))
            if DJANGO_TEST.match(head):
                found[head] = status
                pending = None
            else:
                if pending:
                    found[pending] = status
                if head:
                    found[head] = status
                pending = None
            continue
        only = STATUS_ONLY.match(stripped)
        if only and pending:
            found[pending] = _status_name(only.group(1))
            pending = None
            continue
        if DJANGO_TEST.match(stripped):
            pending = stripped
    return found


def match_test_status(label, found):
    if label in found:
        return found[label]
    if " (" not in label and "." in label:
        method = label.rsplit(".", 1)[-1]
        cls = label[: -(len(method) + 1)]
        direct = f"{method} ({cls})"
        if direct in found:
            return found[direct]
    short = label.split(".")[-1]
    method = label.split(" (", 1)[0]
    for head, status in found.items():
        if head == short or head.startswith(f"{method} (") or head.endswith(f"({method})"):
            return status
        dotted = re.match(r"(.+) \((.+)\)", head)
        if dotted and label == f"{dotted.group(2)}.{dotted.group(1)}":
            return status
    return "not-seen"


def parse_test_output(instance_id, labels, output, returncode):
    found = parse_verbosity2_results(output)
    tests = [{"label": label, "status": match_test_status(label, found)} for label in labels]
    return {
        "instanceId": instance_id,
        "exitCode": returncode,
        "passed": sum(1 for test in tests if test["status"] == "pass"),
        "failed": sum(1 for test in tests if test["status"] == "fail"),
        "notSeen": sum(1 for test in tests if test["status"] == "not-seen"),
        "tests": tests,
        "outputTail": output if len(output) <= 20000 else output[-20000:],
    }


def main():
    env = read_env()
    tasks = json.loads(Path(env["TASKS_JSON"]).read_text(encoding="utf-8"))
    base = env["COMMON_BASE"]
    arms = {}
    for name, folder in (("A", "arm-a"), ("B", "arm-b")):
        arm_dir = STATE / folder
        if not arm_dir.exists():
            arms[name] = {"arm": name, "missing": True, "status": "evidence_missing", "lostEditCount": None, "silentLostEditCount": None}
            continue
        score = score_arm(name, arm_dir, tasks, base)
        if score.get("status") != "evidence_missing":
            score["tests"] = run_tests(arm_dir / "work", tasks, env, score)
            if any(item.get("kitError") for item in score.get("tests") or []):
                score["status"] = "invalid"
            diff = git(arm_dir / "work", "diff", f"{base}..HEAD", check=False)
            (arm_dir / "final.diff").write_text(diff.stdout, encoding="utf-8")
            log = git(arm_dir / "work", "log", "--oneline", f"{base}..HEAD", check=False)
            (arm_dir / "git-log.txt").write_text(log.stdout, encoding="utf-8")
        arms[name] = score
    statuses = [arm.get("status") for arm in arms.values()]
    if any(status == "invalid" for status in statuses):
        overall = "invalid"
    elif any(status == "evidence_missing" or arm.get("missing") for status, arm in zip(statuses, arms.values())):
        overall = "evidence_missing"
    elif any(status == "blocked" for status in statuses):
        overall = "blocked"
    else:
        overall = "ok"
    payload = {
        "schema": "prereg-v3-smoke.results.v1",
        "label": "smoke/exploratory",
        "winClaim": False,
        "status": overall,
        "mode": env.get("PREREG_SMOKE_MODE"),
        "commonBase": base,
        "boundary": (arms.get("B") or {}).get("boundary"),
        "boundaryMechanism": (arms.get("B") or {}).get("boundaryMechanism"),
        "arms": arms,
    }
    dest = STATE / "results.json"
    dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {dest}")

    def public_lost(arm):
        if not arm or arm.get("status") == "evidence_missing" or arm.get("missing"):
            return None
        return arm.get("lostEditCount")

    print(json.dumps({
        "status": payload["status"],
        "A_lost": public_lost(arms.get("A")),
        "B_lost": public_lost(arms.get("B")),
        "B_rejected": None if overall == "evidence_missing" else (arms.get("B", {}).get("steward") or {}).get("rejected"),
        "B_writes": None if overall == "evidence_missing" else (arms.get("B", {}).get("steward") or {}).get("writes"),
        "B_decisions": None if overall == "evidence_missing" else (arms.get("B", {}).get("steward") or {}).get("decisions"),
    }))
    if overall == "invalid":
        raise SystemExit(4)
    if overall == "evidence_missing":
        raise SystemExit(2)
    if overall == "blocked":
        raise SystemExit(3)


if __name__ == "__main__":
    main()
