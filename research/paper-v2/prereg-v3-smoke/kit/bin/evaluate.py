#!/usr/bin/env python3
"""Score one smoke run. Writes results.json. Exploratory; no win claim."""
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

STATE = Path(os.environ.get("PREREG_SMOKE_STATE") or Path(__file__).resolve().parents[1] / "state")
ENV = STATE / "env.sh"


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


def session_rejected(rows, instance_id):
    return any(
        (row.get("taskId") == instance_id or instance_id in str(row.get("actorId")))
        and row.get("terminal") not in (None, "committed")
        for row in rows
    )


def score_arm(arm_name, arm_dir, tasks, base):
    work = arm_dir / "work"
    rows = steward_rows(work)
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
        if intended_path.exists():
            parts = split_patch(intended_path.read_text(encoding="utf-8"))
            instance_id = None
            prompt = (session / "prompt.txt").read_text(encoding="utf-8", errors="replace") if (session / "prompt.txt").exists() else ""
            for instance in tasks["primary"]["instances"]:
                if instance["problemStatement"][:80] in prompt or instance["instanceId"] in stdout:
                    instance_id = instance["instanceId"]
                    break
            if instance_id is None and slot - 1 < len(tasks["primary"]["instances"]):
                instance_id = tasks["primary"]["instances"][slot - 1]["instanceId"]
            rejected = session_rejected(rows, instance_id)
            for file, patch in parts.items():
                try:
                    base_text = git(work, "show", f"{base}:{file}").stdout
                except RuntimeError:
                    base_text = ""
                final = work / file
                final_text = final.read_text(encoding="utf-8") if final.exists() else ""
                missing = [line for line in added_lines(patch) if line not in final_text]
                item = {"file": file, "missingAddedLines": missing[:12], "missingCount": len(missing)}
                if missing and not rejected:
                    lost.append(item)
                elif missing and rejected:
                    item["classified"] = "steward-rejected"
                    kept.append(item)
                else:
                    kept.append({"file": file, "missingCount": 0})
        else:
            instance_id = tasks["primary"]["instances"][slot - 1]["instanceId"]
            rejected = False
        sessions.append({
            "slot": slot,
            "instanceId": instance_id,
            "startedAt": (session / "started-at").read_text().strip() if (session / "started-at").exists() else None,
            "endedAt": (session / "ended-at").read_text().strip() if (session / "ended-at").exists() else None,
            "exitCode": exit_code,
            "tokens": tokens_of(session),
            "lostEdits": lost,
            "keptOrRejected": kept,
            "stewardRejected": rejected,
            "quotaStop": (session / "QUOTA_STOP").exists(),
        })
    corruption = []
    for path in work.rglob("*"):
        if not path.is_file() or ".git" in path.parts or "venv" in path.parts:
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
    return {
        "arm": arm_name,
        "work": str(work),
        "head": git(work, "rev-parse", "HEAD", check=False).stdout.strip(),
        "startSkewMs": int((arm_dir / "start-skew-ms").read_text().strip()) if (arm_dir / "start-skew-ms").exists() else None,
        "model": (arm_dir / "model.txt").read_text().strip() if (arm_dir / "model.txt").exists() else None,
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
            "recomposeOrRetry": sum(int(row.get("retryCount") or 0) + int(row.get("hashDriftCount") or 0) + int((row.get("commit") or {}).get("headMoves") or 0) for row in rows),
            "queueWaitMs": [int((row.get("commit") or {}).get("gitIndexLockWaitMs") or 0) for row in rows],
            "writeToCommitMs": latencies,
            "batchSizes": [row.get("batchSize") for row in rows],
            "terminals": [row.get("terminal") for row in rows],
        },
    }


def run_tests(work, tasks, env, arm_score):
    mode = env.get("PREREG_SMOKE_MODE")
    python = env.get("PREREG_PYTHON") or "python3"
    results = []
    if mode == "fixture":
        for instance in tasks["primary"]["instances"]:
            labels = instance["FAIL_TO_PASS"] + instance["PASS_TO_PASS"]
            proc = subprocess.run([python, "runtests.py", *labels], cwd=work, text=True, capture_output=True)
            results.append(parse_test_output(instance["instanceId"], labels, proc.stdout + proc.stderr, proc.returncode))
        return results
    gold_root = Path(env["KIT_ROOT"])
    for instance in tasks["primary"]["instances"]:
        labels = [label for label in instance["FAIL_TO_PASS"] + instance["PASS_TO_PASS"] if " (" in label or label.startswith("test_")]
        mapped = []
        for label in labels:
            match = re.match(r"(.+) \((.+)\)", label)
            mapped.append(f"{match.group(2)}.{match.group(1)}" if match else label)
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
            test_patch = gold_root / instance["testPatch"]
            applied = subprocess.run(["/usr/bin/git", "-C", str(clone), "apply", str(test_patch)], text=True, capture_output=True)
            proc = subprocess.run(
                [python, "tests/runtests.py", "--verbosity", "1", "--settings=test_sqlite", *mapped],
                cwd=clone,
                text=True,
                capture_output=True,
            )
            parsed = parse_test_output(instance["instanceId"], mapped, proc.stdout + proc.stderr, proc.returncode)
            parsed["testPatchApplied"] = applied.returncode == 0
            parsed["testPatchError"] = None if applied.returncode == 0 else (applied.stderr or "")[-400:]
            results.append(parsed)
    arm_score["tests"] = results
    return results


def parse_test_output(instance_id, labels, output, returncode):
    tests = []
    for label in labels:
        short = label.split(".")[-1]
        if re.search(rf"{re.escape(short)}.*\bok\b", output):
            status = "pass"
        elif re.search(rf"{re.escape(short)}.*(FAIL|ERROR)", output):
            status = "fail"
        else:
            status = "not-seen"
        tests.append({"label": label, "status": status})
    return {
        "instanceId": instance_id,
        "exitCode": returncode,
        "passed": sum(1 for test in tests if test["status"] == "pass"),
        "failed": sum(1 for test in tests if test["status"] == "fail"),
        "notSeen": sum(1 for test in tests if test["status"] == "not-seen"),
        "tests": tests,
        "outputTail": output[-1200:],
    }


def main():
    env = read_env()
    tasks = json.loads(Path(env["TASKS_JSON"]).read_text(encoding="utf-8"))
    base = env["COMMON_BASE"]
    arms = {}
    for name, folder in (("A", "arm-a"), ("B", "arm-b")):
        arm_dir = STATE / folder
        if not arm_dir.exists():
            arms[name] = {"arm": name, "missing": True}
            continue
        score = score_arm(name, arm_dir, tasks, base)
        score["tests"] = run_tests(arm_dir / "work", tasks, env, score)
        diff = git(arm_dir / "work", "diff", f"{base}..HEAD", check=False)
        (arm_dir / "final.diff").write_text(diff.stdout, encoding="utf-8")
        log = git(arm_dir / "work", "log", "--oneline", f"{base}..HEAD", check=False)
        (arm_dir / "git-log.txt").write_text(log.stdout, encoding="utf-8")
        arms[name] = score
    payload = {
        "schema": "prereg-v3-smoke.results.v1",
        "label": "smoke/exploratory",
        "winClaim": False,
        "mode": env.get("PREREG_SMOKE_MODE"),
        "commonBase": base,
        "arms": arms,
    }
    dest = STATE / "results.json"
    dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {dest}")
    print(json.dumps({
        "A_lost": arms.get("A", {}).get("lostEditCount"),
        "B_lost": arms.get("B", {}).get("lostEditCount"),
        "B_rejected": (arms.get("B", {}).get("steward") or {}).get("rejected"),
        "B_writes": (arms.get("B", {}).get("steward") or {}).get("writes"),
    }))


if __name__ == "__main__":
    main()
