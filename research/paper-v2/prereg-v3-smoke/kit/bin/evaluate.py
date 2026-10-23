#!/usr/bin/env python3
"""Score one smoke run. Writes results.json. Exploratory; no win claim."""
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from kit_generation import generation_metadata
from metrics_provenance import journal_evidence, rows_for_session, loss_items, measured_wait, journal_resubmissions

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
    """行文字比對。新增行出現在檔案別處也會算落地，所以只當 hunk 對不上時的低信心退路。"""
    final_lines = set(final_text.splitlines())
    missing = [line for line in added_lines(patch_text) if line not in final_lines]
    deleted_in_final = set(removed_lines(final_diff_text))
    for line in removed_lines(patch_text):
        if line in final_lines and line not in deleted_in_final:
            missing.append(line)
    return missing


HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def structured_hunks(patch_text):
    """每個 hunk 拆成仍可 git apply 的單 hunk patch。任一 @@ 對不上標準標頭就回 None。"""
    if "@@" not in patch_text:
        return None
    parts = split_patch(patch_text)
    if not parts:
        return None
    hunks = []
    for chunk in parts.values():
        header = []
        current = None
        for line in chunk.splitlines(keepends=True):
            if line.startswith("@@"):
                if HUNK_HEADER.match(line.rstrip("\n")) is None:
                    return None
                if current:
                    hunks.append("".join(header) + "".join(current))
                current = [line]
                continue
            if current is None:
                header.append(line)
            else:
                current.append(line)
        if current:
            hunks.append("".join(header) + "".join(current))
    return hunks or None


def rewrite_patch_paths(patch_text):
    normalised = re.sub(r"^diff --git a/\S+ b/\S+\n", "diff --git a/target b/target\n", patch_text, count=1, flags=re.M)
    normalised = re.sub(r"^--- a/\S+\n", "--- a/target\n", normalised, count=1, flags=re.M)
    normalised = re.sub(r"^\+\+\+ b/\S+\n", "+++ b/target\n", normalised, count=1, flags=re.M)
    return normalised


def hunk_present(final_text, hunk_patch):
    """hunk 的修改後內容就在最終檔裡時，git apply --reverse --check 會過。"""
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run(["/usr/bin/git", "init", "-q", directory], check=True, capture_output=True)
        target = Path(directory) / "target"
        target.write_text(final_text, encoding="utf-8")
        patch = Path(directory) / "p.diff"
        patch.write_text(rewrite_patch_paths(hunk_patch), encoding="utf-8")
        result = subprocess.run(
            ["/usr/bin/git", "apply", "--reverse", "--check", "--unsafe-paths", str(patch)],
            cwd=directory,
            text=True,
            capture_output=True,
        )
        return result.returncode == 0


def score_patch_lines(patch_text, final_text, final_diff_text):
    """回傳 (沒落地的行, confidence)。

    hunk 能整段 reverse-apply 到最終檔才算高信心落地。行文字也說沒落地時，用 hunk 的缺行。
    兩者不一致（例如兩臂都改了同一區，行在檔裡但原 hunk 已經對不上）標成 low，
    不把還在檔裡的行記成遺失。沒有標準 hunk 時也是 low，退回行文字比對。
    """
    line_missing = missing_edit_lines(patch_text, final_text, final_diff_text)
    hunks = structured_hunks(patch_text)
    if hunks is None:
        return line_missing, "low"
    hunk_missing = []
    for hunk in hunks:
        if hunk_present(final_text, hunk):
            continue
        hunk_missing.extend(added_lines(hunk))
        hunk_missing.extend(removed_lines(hunk))
    if not hunk_missing:
        return [], "hunk"
    if not line_missing:
        return [], "low"
    return hunk_missing, "hunk"


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
        subprocess.run(["/usr/bin/git", "init", "-q", directory], check=True, capture_output=True)
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
    keys = ("input_tokens", "output_tokens", "total_tokens", "cached_input_tokens", "reasoning_output_tokens")
    usages = []
    def collect(value):
        if isinstance(value, dict):
            if isinstance(value.get("usage"), dict):
                usages.append(value["usage"])
            for key, child in value.items():
                if key != "usage":
                    collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)
    path = session / "stdout.jsonl"
    if path.is_file():
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                collect(json.loads(line))
            except json.JSONDecodeError:
                continue
    # An incomplete sum would look like a measured total. Preserve unknowns.
    return {**{key: sum(row[key] for row in usages)
               if usages and all(type(row.get(key)) is int and row[key] >= 0 for row in usages)
               else None for key in keys}, "events": len(usages)}


def conflict_count(arm_dir, rows, overwrite_conflicts=None):
    """Observed journal contention, independent of declared/live hash equality."""
    count = arm_index_lock_count(arm_dir)
    explicit = {i for i, row in enumerate(rows) if row.get("reasonCode") in {
        "cross-session-overlap", "overlapping-write-queued", "overlapping-write-conflict"
    } or row.get("acknowledgedOverlap")}
    explicit.update(overwrite_conflicts or set())
    if explicit:
        return (count or 0) + len(explicit)
    if any(row.get("reasonCode") == "patch-context-mismatch" for row in rows):
        return count if count else None
    return count if count is not None else (0 if rows and all(
        row.get("crossSessionOverlap") == [] and row.get("decision") == "accepted" for row in rows
    ) else None)


def cross_session_counts(rows):
    """#360: cross-session-overlap outcomes, counted apart from patch-context-mismatch,
    stale-base and overlapping-write-queued. An acknowledged override of another
    session's committed line is reported as such, never as a plain accepted write."""
    counts = {"crossSessionOverlapRejections": 0, "acknowledgedOverrides": 0, "mergedBothResubmissions": 0}
    pending = set()
    for row in rows:
        key = (row.get("actorId"), row.get("file"))
        if row.get("reasonCode") == "cross-session-overlap":
            counts["crossSessionOverlapRejections"] += 1
            pending.add(key)
        elif row.get("decision") == "accepted":
            if row.get("acknowledgedOverlap"):
                counts["acknowledgedOverrides"] += 1
            elif key in pending:
                counts["mergedBothResubmissions"] += 1
            pending.discard(key)
    return counts


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
    if reason == "base-unknown":
        return "rejected-by-design"
    if row.get("terminal") in {"blocked", "queued"} and reason:
        return "rejected-by-design"
    return "kit-error"


def blocked_steward_write(row):
    if classify_write(row) == "rejected-by-design":
        return True
    reason = str(row.get("reasonCode") or row.get("stopReason") or "").strip()
    return row.get("terminal") in {"blocked", "queued"} and bool(reason)


def recompose_or_retry(arm_dir):
    """重送次數是 session 呼叫紀錄裡、每個 session 第一筆 atm-write 之後的呼叫。
    沒有命令紀錄時是 None。拒絕次數另外記在 steward.rejected，不從拒絕列推重送。
    """
    return resubmission_count(arm_dir)


GIT_ADD_OR_COMMIT = re.compile(
    r"(?:^|[\s'\"`=])(?:\S*/)?git(?:\s+-c\s+\S+|\s+-C\s+\S+)*\s+(?:add|commit)\b"
)
ATM_WRITE_CALL = re.compile(r"(?:^|[\s'\"`=])(?:\S*/)?atm-write(?:\s|$)")
ATM_WRITE_FILE = re.compile(r"(?:^|[\s'\"`=])(?:\S*/)?atm-write\s+(\S+)")


def iter_log_events(text):
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            yield event


# Codex 0.163.0 的 exec JSONL 是 item.completed + item.type=command_execution。
# 同一版也可能把結束事件放在 exec_command_end，欄位名略有不同。模型訊息不是命令。
COMMAND_ITEM_TYPES = {"command_execution", "exec_command", "local_shell"}


def coerce_exit_code(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def command_record(event):
    """從一筆事件取出命令本體。started / agent_message 回 None。"""
    if event.get("type") == "item.completed":
        item = event.get("item") if isinstance(event.get("item"), dict) else None
        if item and item.get("type") in COMMAND_ITEM_TYPES:
            return item
        return None
    if event.get("type") in {"exec_command_end", "command_execution"}:
        if event.get("command") or event.get("cmd"):
            return event
    return None


def command_text(record):
    return str(record.get("command") or record.get("cmd") or "")


def command_output(record):
    parts = []
    for key in ("aggregated_output", "output", "stdout", "stderr"):
        value = record.get(key)
        if isinstance(value, str) and value:
            parts.append(value)
    return "\n".join(parts)


def command_failed(record):
    exit_code = coerce_exit_code(record.get("exit_code"))
    if exit_code is None:
        exit_code = coerce_exit_code(record.get("exitCode"))
    if exit_code is not None:
        return exit_code != 0
    return str(record.get("status") or "").lower() in {"failed", "error"}


def completed_commands(text):
    """Codex 一筆命令先 started 再 completed。只算完成的命令，並用 item id 去重。"""
    seen = set()
    for event in iter_log_events(text):
        if event.get("type") == "stub.atm-write":
            yield {"kind": "atm-write", "id": f"stub-{event.get('attempt')}-{event.get('file')}", "event": event}
            continue
        if event.get("type") == "stub.git":
            yield {"kind": "stub-git", "id": "stub-git", "event": event}
            continue
        item = command_record(event)
        if not item:
            continue
        item_id = item.get("id") or item.get("call_id")
        if item_id in seen:
            continue
        if item_id:
            seen.add(item_id)
        command = command_text(item)
        if ATM_WRITE_CALL.search(command):
            yield {"kind": "atm-write", "id": item_id, "event": item, "command": command}
        elif GIT_ADD_OR_COMMIT.search(command):
            yield {"kind": "git-add-commit", "id": item_id, "event": item, "command": command}
        else:
            yield {"kind": "command", "id": item_id, "event": item, "command": command}


def session_stdout(session):
    path = session / "stdout.jsonl"
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def command_log_observed(text):
    for item in completed_commands(text):
        return True
    return False


def steward_decision(record):
    for line in command_output(record).splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and obj.get("decision") is not None:
            return str(obj.get("decision"))
    return ""


def intended_edit(item):
    """同一份意圖修改以 atm-write 的檔案路徑辨認。認不出路徑就不併進別的修改。"""
    command = item.get("command")
    if command:
        match = ATM_WRITE_FILE.search(command)
        return match.group(1) if match else None
    target = item["event"].get("file")
    return str(target) if target else None


def is_steward_rejection(item):
    """steward 拒絕才算。命令找不到、kit-error、以及模型自己的句子都不是拒絕。"""
    event = item["event"]
    if item.get("command") is None:
        return str(event.get("decision") or "").startswith("rejected")
    decision = steward_decision(event)
    if decision.startswith("rejected"):
        return True
    if decision in {"accepted", "kit-error"}:
        return False
    output = command_output(event)
    exit_code = coerce_exit_code(event.get("exit_code"))
    if exit_code is None:
        exit_code = coerce_exit_code(event.get("exitCode"))
    if exit_code == 127 or "command not found" in output:
        return False
    return exit_code == 3


def session_resubmissions(text):
    """同一份意圖修改被拒絕之後，後續的 atm-write 才算重送。第一筆拒絕本身不算。"""
    rejected = set()
    count = 0
    for item in completed_commands(text):
        if item["kind"] != "atm-write":
            continue
        target = intended_edit(item)
        if target and target in rejected:
            count += 1
        if target and is_steward_rejection(item):
            rejected.add(target)
    return count


def resubmission_count(arm_dir):
    """兩支 session 的重送次數相加。都沒有命令紀錄時回 None。"""
    observed = False
    total = 0
    for slot in (1, 2):
        text = session_stdout(arm_dir / f"session-{slot}")
        if not command_log_observed(text):
            continue
        observed = True
        total += session_resubmissions(text)
    if not observed:
        return None
    return total


def index_lock_count(text):
    """命令紀錄裡失敗的 git add / git commit，而且輸出含 index.lock。

    有命令紀錄但沒有這種失敗時是 0。完全沒有命令紀錄時才是 None。
    模型訊息裡的 index.lock 不算。
    """
    if not command_log_observed(text):
        return None
    count = 0
    for item in completed_commands(text):
        if item["kind"] == "stub-git":
            event = item["event"]
            err = str(event.get("stderr") or "")
            if "index.lock" not in err:
                continue
            if event.get("addStatus") not in (0, None):
                count += 1
            if event.get("commitStatus") not in (0, None):
                count += 1
            continue
        if item["kind"] != "git-add-commit":
            continue
        event = item["event"]
        output = command_output(event)
        if command_failed(event) and "index.lock" in output:
            count += 1
    return count


def arm_index_lock_count(arm_dir):
    count = 0
    found = False
    for slot in (1, 2):
        session_count = index_lock_count(session_stdout(arm_dir / f"session-{slot}"))
        if session_count is None:
            continue
        found = True
        count += session_count
    if not found:
        return None
    return count


def hunk_spans(patch_text):
    spans = []
    for line in patch_text.splitlines():
        match = HUNK_HEADER.match(line)
        if not match:
            continue
        start = int(match.group(1))
        count = int(match.group(2) or "1")
        if count <= 0:
            spans.append((start, start))
        else:
            spans.append((start, start + count - 1))
    return spans


def spans_overlap(left, right):
    return left[0] <= right[1] and right[0] <= left[1]


def rejected_command_patches(text):
    """從失敗的 atm-write 命令取出 (file, patch)。stub 事件沒有 patch 本文。"""
    found = []
    saw_unparsed = False
    for item in completed_commands(text):
        if item["kind"] != "atm-write":
            continue
        event = item["event"]
        if item.get("command") is None:
            status = event.get("status")
            decision = str(event.get("decision") or "")
            if status not in (0, None) or decision.startswith("rejected"):
                saw_unparsed = True
            continue
        exit_code = event.get("exit_code")
        output = str(event.get("aggregated_output") or "")
        failed = (isinstance(exit_code, int) and exit_code != 0) or '"ok": false' in output or '"ok":false' in output
        if not failed:
            continue
        command = item["command"]
        file_match = ATM_WRITE_FILE.search(command)
        diff_at = command.find("diff --git ")
        if not file_match or diff_at < 0:
            saw_unparsed = True
            continue
        found.append((file_match.group(1), command[diff_at:]))
    return found, saw_unparsed


def filename_rejected(rows, session_files):
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


def session_rejected(rows, session_files, intended_parts=None, stdout=""):
    """有命令裡的 hunk 時，只在行範圍和該 session 的意圖 patch 重疊才算這支 session 被拒絕。
    沒有 hunk 時退回檔名，呼叫端把信心標成 low。
    """
    rejected, _confidence = rejection_for_session(rows, session_files, intended_parts, stdout)
    return rejected


def normalize_hash(value):
    return str(value or "").replace("sha256:", "")


def false_accept_row(row):
    """CLI 說 accepted，但檔案雜湊沒有變。那一筆沒有落地，不是 steward 拒絕。"""
    if classify_write(row) != "accepted":
        return False
    declared = normalize_hash(row.get("declaredBaseHash"))
    current = normalize_hash(row.get("currentFileHash"))
    return bool(declared) and declared == current


def write_receipts(text):
    receipts = []
    for item in completed_commands(text):
        if item["kind"] != "atm-write" or item.get("command") is None:
            continue
        for line in command_output(item["event"]).splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict) and (obj.get("proposalId") or obj.get("decision") is not None):
                receipts.append(obj)
                break
    return receipts


def session_rows_by_proposal(rows, text):
    """用 session 寫入紀錄裡的 proposalId 對上 steward log。沒有 id 時回 None，呼叫端改走 hunk。"""
    ids = [receipt.get("proposalId") for receipt in write_receipts(text) if receipt.get("proposalId")]
    if not ids:
        return None
    wanted = set(ids)
    return [row for row in rows if row.get("proposalId") in wanted]


def rejection_for_session(rows, session_files, intended_parts=None, stdout=""):
    files = {path for path in (session_files or []) if path}
    if not files:
        return False, "none"
    linked = session_rows_by_proposal(rows, stdout or "")
    if linked is not None:
        real = [
            row for row in linked
            if blocked_steward_write(row) and not false_accept_row(row)
        ]
        return bool(real), "proposal"
    submitted, saw_unparsed = rejected_command_patches(stdout or "")
    if not submitted and not saw_unparsed:
        if not filename_rejected(rows, files):
            return False, "none"
        return True, "low"
    intended_parts = intended_parts or {}
    overlapped = False
    low = saw_unparsed
    for path, patch in submitted:
        if path not in files:
            continue
        spans = hunk_spans(patch)
        intended = hunk_spans(intended_parts.get(path, ""))
        if not spans or not intended:
            low = True
            if filename_rejected(rows, [path]):
                overlapped = True
            continue
        if any(spans_overlap(left, right) for left in spans for right in intended):
            overlapped = True
    if low:
        return overlapped or filename_rejected(rows, files), "low"
    return overlapped, "hunk"


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


SNAPSHOT_SKIP = {".git", "venv", ".prereg-smoke", ".atm", ".agents", ".codex", ".aws"}
SNAPSHOT_PATHSPEC = (":!venv", ":!.prereg-smoke", ":!.atm", ":!.agents", ":!.codex", ":!.aws")


def path_is_snapshot_skip(path):
    return any(part in SNAPSHOT_SKIP for part in Path(path).parts)


def parse_status_paths(stdout):
    paths = []
    for line in stdout.splitlines():
        if len(line) < 4:
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path_is_snapshot_skip(path):
            continue
        paths.append(path)
    return paths


def task_dirty_paths(work):
    result = git(work, "status", "--porcelain", "--untracked-files=all", check=False)
    if result.returncode != 0:
        raise RuntimeError(f"evaluator snapshot failed: {result.stderr or result.stdout}")
    return parse_status_paths(result.stdout)


def blob_text(work, rev, file):
    result = git(work, "show", f"{rev}:{file}", check=False)
    if result.returncode != 0:
        return ""
    return result.stdout


def freeze_worktree_snapshot(work):
    """把工作樹收成一個評估用 commit。乾淨的樹也做一個空 commit。

    v7 Arm B 的任務檔已經在 steward HEAD 上，只有 .atm 與 .prereg-smoke 未追蹤。
    舊邏輯因此不建立 commit，snapshotCreated 是 false，未完成的拒絕仍被記成 blocked。
    那一次沒有留下評估快照。現在每次都寫 `prereg evaluator snapshot`。
    git status 失敗、或 commit 寫不進 .git，都是失敗，不能假裝樹是乾淨的。
    同一份 commit 接著給遺失修改、測試複本與 base..snapshot diff。
    """
    head = git(work, "rev-parse", "HEAD", check=False)
    if head.returncode != 0:
        raise RuntimeError(f"evaluator snapshot failed: {head.stderr or head.stdout}")
    before = head.stdout.strip()
    dirty = task_dirty_paths(work)
    commit_args = [
        "-c", "user.name=prereg-evaluator",
        "-c", "user.email=prereg-evaluator@localhost",
        "commit", "-q", "-m", "prereg evaluator snapshot",
    ]
    if dirty:
        add = git(work, "add", "-A", "--", ".", *SNAPSHOT_PATHSPEC, check=False)
        if add.returncode != 0:
            raise RuntimeError(f"evaluator snapshot failed: {add.stderr or add.stdout}")
        cached = git(work, "diff", "--cached", "--quiet", check=False)
        if cached.returncode == 0:
            still = task_dirty_paths(work)
            raise RuntimeError("evaluator snapshot did not capture uncommitted edits: " + ", ".join(still[:8]))
    else:
        commit_args.insert(5, "--allow-empty")
    commit = git(work, *commit_args, check=False)
    if commit.returncode != 0:
        raise RuntimeError(f"evaluator snapshot failed: {commit.stderr or commit.stdout}")
    after = git(work, "rev-parse", "HEAD", check=False)
    if after.returncode != 0:
        raise RuntimeError(f"evaluator snapshot failed: {after.stderr or after.stdout}")
    sha = after.stdout.strip()
    if sha == before:
        raise RuntimeError("evaluator snapshot did not create a commit")
    still = task_dirty_paths(work)
    if still:
        raise RuntimeError("evaluator snapshot left uncommitted edits: " + ", ".join(still[:8]))
    return {"sha": sha, "created": True}


def snapshot_failure(arm_name, arm_dir, message):
    fields = arm_model_fields(arm_dir)
    return {
        "arm": arm_name,
        "status": "invalid",
        "snapshotError": message,
        "work": str(arm_dir / "work"),
        "model": fields["model"],
        "reasoningEffort": fields["reasoningEffort"],
        "sessions": [],
        "lostEditCount": None,
        "silentLostEditCount": None,
        "indexLockCount": None,
        "lostEditConfidence": "low",
        "rejectionAttribution": "low",
        "snapshotCreated": False,
        "tests": [{
            "instanceId": None,
            "kitError": "evaluator-snapshot-failed",
            "note": message,
            "tests": [],
        }],
    }


def checkout_snapshot(work, destination):
    """複本只含評估快照的 HEAD。呼叫前必須已經 freeze，否則未提交修改不會進來。"""
    subprocess.run(
        ["/usr/bin/git", "clone", "--quiet", "--shared", str(work), str(destination)],
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        ["/usr/bin/git", "-c", "advice.detachedHead=false", "-C", str(destination), "checkout", "--force", "--detach", "--quiet", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )


def score_arm(arm_name, arm_dir, tasks, base):
    gaps = evidence_gaps(arm_dir)
    if gaps:
        return missing_arm(arm_name, arm_dir, gaps)
    work = arm_dir / "work"
    try:
        snapshot = freeze_worktree_snapshot(work)
    except RuntimeError as exc:
        return snapshot_failure(arm_name, arm_dir, str(exc))
    rows = steward_rows(work)
    accepted_losses, overwrite_conflicts = journal_evidence(
        rows, lambda file: blob_text(work, base, file), lambda file: blob_text(work, "HEAD", file))
    final_diff_text = git(work, "diff", f"{base}..HEAD", check=False).stdout
    final_parts = split_patch(final_diff_text)
    blocked_files = {row.get("file") for row in rows if row.get("file") and blocked_steward_write(row)}
    sessions = []
    git_errors = []
    for slot in (1, 2):
        session = arm_dir / f"session-{slot}"
        stderr = (session / "stderr.txt").read_text(encoding="utf-8", errors="replace") if (session / "stderr.txt").exists() else ""
        stdout = session_stdout(session)
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
        rejected, rejection_confidence = rejection_for_session(rows, parts.keys(), parts, stdout)
        indices = rows_for_session(rows, slot, stdout, session_rows_by_proposal)
        provenance_losses = loss_items(accepted_losses, indices, rows)
        unfinished = []
        session_match = "hunk"
        for file, patch in parts.items():
            if is_codex_runtime_path(file):
                continue
            final_text = blob_text(work, "HEAD", file)
            missing, match = score_patch_lines(patch, final_text, final_parts.get(file, ""))
            if match == "low":
                session_match = "low"
            item = {
                "file": file,
                "missingAddedLines": missing[:12],
                "missingCount": len(missing),
                "match": match,
            }
            # 被 steward 擋住的意圖修改，只要最終快照沒有它，就是未完成，不是沉默遺失。
            # hunk 歸因只算這支 session；低信心才退回檔名。
            if rejection_confidence == "proposal":
                blocked = any(
                    row.get("file") == file and blocked_steward_write(row) and not false_accept_row(row)
                    for row in (session_rows_by_proposal(rows, stdout) or [])
                )
            elif rejection_confidence == "hunk":
                blocked = rejected
            else:
                blocked = rejected or file in blocked_files
            # Remove proven accepted losses from the rejection fallback. Keep any
            # never-accepted lines as separate unfinished intent on the same file.
            proven = {line for loss in provenance_losses if loss["file"] == file for line in loss["missingAddedLines"]}
            if proven:
                missing = missing_edit_lines(patch, final_text, final_parts.get(file, ""))
            missing = [line for line in missing if line not in proven]
            item["missingAddedLines"], item["missingCount"] = missing[:12], len(missing)
            if missing and not blocked:
                lost.append(item)
                unfinished.append(item)
            elif missing and blocked:
                item["classified"] = "steward-rejected"
                kept.append(item)
                unfinished.append(item)
            else:
                kept.append({"file": file, "missingCount": 0, "match": match})
        for item in provenance_losses:
            lost.append(item)
            unfinished.append(item)
        reported = any(blocked_steward_write(rows[i]) or rows[i].get("crossSessionOverlap")
                       or rows[i].get("acknowledgedOverlap") for i in indices)
        sessions.append({
            "slot": slot,
            "evidenceStatus": "ok",
            "instanceId": instance_id,
            "startedAt": (session / "started-at").read_text().strip() if (session / "started-at").exists() else None,
            "endedAt": (session / "ended-at").read_text().strip() if (session / "ended-at").exists() else None,
            "exitCode": exit_code,
            "tokens": tokens_of(session),
            "lostEdits": lost,
            "silentLostEdits": [] if reported or rejected else lost,
            "unfinishedEdits": unfinished,
            "keptOrRejected": kept,
            "stewardRejected": rejected,
            "lostEditConfidence": session_match,
            "rejectionAttribution": rejection_confidence,
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
    index_lock = arm_index_lock_count(arm_dir)
    resubmissions = journal_resubmissions(rows)
    if resubmissions is None:
        resubmissions = recompose_or_retry(arm_dir)
    match_values = [session["lostEditConfidence"] for session in sessions]
    lost_confidence = "low" if "low" in match_values else "hunk"
    attributions = [session["rejectionAttribution"] for session in sessions]
    if "low" in attributions:
        attribution = "low"
    elif "proposal" in attributions:
        attribution = "proposal"
    elif "hunk" in attributions:
        attribution = "hunk"
    else:
        attribution = "none"
    rejected_count = sum(1 for row in rows if row.get("terminal") not in (None, "committed"))
    return {
        "arm": arm_name,
        "boundary": boundary.get("boundary"),
        "boundaryMechanism": boundary.get("mechanism"),
        "status": status,
        "work": str(work),
        "head": snapshot["sha"],
        "snapshot": snapshot["sha"],
        "snapshotCreated": snapshot["created"],
        "startSkewMs": int((arm_dir / "start-skew-ms").read_text().strip()) if (arm_dir / "start-skew-ms").exists() else None,
        "model": fields["model"],
        "reasoningEffort": fields["reasoningEffort"],
        "sessions": sessions,
        "lostEditCount": sum(len(session["lostEdits"]) for session in sessions),
        "silentLostEditCount": sum(len(session["silentLostEdits"]) for session in sessions),
        "lostEditConfidence": lost_confidence,
        "rejectionAttribution": attribution,
        "corruption": corruption,
        "indexLockCount": index_lock,
        "gitErrors": git_errors,
        "conflictCount": conflict_count(arm_dir, rows, overwrite_conflicts),
        "resolutionTimeMs": None,
        "steward": {
            "writes": len(rows),
            "rejected": rejected_count,
            "resubmissions": resubmissions,
            "retryCount": resubmissions,
            "recomposeOrRetry": resubmissions,
            **cross_session_counts(rows),
            "queueWaitMs": [measured_wait(row) for row in rows],
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
    """零筆觀察、測試 patch 沒套上、任一 id 沒被觀察到，或分母是 0，都是 kit-error。

    空的 FAIL_TO_PASS 與 PASS_TO_PASS 不是未觀察。有 id 卻對不出 Django label，
    呼叫端要先把 kitError 設成 test-id-unmapped，分數維持 null，不能記成 0/0。
    """
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
        if summary["denominator"] == 0 or summary["notSeen"] == summary["denominator"]:
            return "denominator-unobserved"
        if summary["notSeen"]:
            return "tests-unobserved"
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


def test_id_map(tasks):
    """Docstring ids normalize to Django labels. This is id normalization, not a test-content deviation."""
    block = tasks.get("testIdNormalization") or {}
    raw = block.get("map") or {}
    return {str(key): str(value) for key, value in raw.items()}


def resolve_test_ids(labels, id_map):
    """Return (django_labels, unresolved_ids).

    `test_x (module.Class)` becomes `module.Class.test_x`. A docstring id uses the
    normalization map. Anything else is unresolved and must not be dropped into a 0 denominator.
    """
    mapped = []
    unresolved = []
    for label in labels or []:
        text = str(label)
        if " (" in text or text.startswith("test_"):
            match = re.match(r"(.+) \((.+)\)", text)
            mapped.append(f"{match.group(2)}.{match.group(1)}" if match else text)
        elif text in id_map:
            mapped.append(id_map[text])
        else:
            unresolved.append(text)
    return mapped, unresolved


def select_django_labels(labels, id_map=None):
    mapped, _unresolved = resolve_test_ids(labels, id_map or {})
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
        with tempfile.TemporaryDirectory() as scratch:
            clone = Path(scratch) / "tree"
            checkout_snapshot(work, clone)
            for instance in tasks["primary"]["instances"]:
                labels = instance["FAIL_TO_PASS"] + instance["PASS_TO_PASS"]
                proc = subprocess.run([python, "runtests.py", "--verbosity", "2", *labels], cwd=clone, text=True, capture_output=True)
                parsed = parse_test_output(instance["instanceId"], labels, proc.stdout + proc.stderr, proc.returncode)
                results.append(apply_observation_policy(parsed, instance["FAIL_TO_PASS"], instance["PASS_TO_PASS"]))
        return results
    gold_root = Path(env["KIT_ROOT"])
    id_map = test_id_map(tasks)
    for instance in tasks["primary"]["instances"]:
        fail_labels, fail_missing = resolve_test_ids(instance["FAIL_TO_PASS"], id_map)
        pass_labels, pass_missing = resolve_test_ids(instance["PASS_TO_PASS"], id_map)
        missing = fail_missing + pass_missing
        mapped = fail_labels + pass_labels
        if missing:
            parsed = {
                "instanceId": instance["instanceId"],
                "kitError": "test-id-unmapped",
                "note": "FAIL_TO_PASS or PASS_TO_PASS id has no Django label",
                "unmappedTestIds": missing,
                "tests": [],
                "exitCode": None,
            }
            results.append(apply_observation_policy(parsed, fail_labels, pass_labels))
            continue
        if not mapped:
            parsed = {
                "instanceId": instance["instanceId"],
                "note": "no Django test ids in FAIL_TO_PASS or PASS_TO_PASS",
                "tests": [],
                "exitCode": None,
            }
            results.append(apply_observation_policy(parsed, [], []))
            continue
        with tempfile.TemporaryDirectory() as scratch:
            clone = Path(scratch) / "tree"
            checkout_snapshot(work, clone)
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
    A docstring line is recorded under its own text so a SWE-bench docstring id matches the same result.
    Failures are also summarized as 'FAIL: test_x (module.Class)' / 'ERROR: ...'.
    """
    found = {}
    pending = None
    pending_docs = []

    def take(status):
        nonlocal pending, pending_docs
        if pending:
            found[pending] = status
        for doc in pending_docs:
            if doc:
                found[doc] = status
        pending = None
        pending_docs = []

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
                pending_docs = []
            continue
        inline = RESULT_LINE.match(stripped)
        if inline:
            head = inline.group("head").strip()
            status = _status_name(inline.group("status"))
            if DJANGO_TEST.match(head):
                found[head] = status
                pending = None
                pending_docs = []
            else:
                if head:
                    pending_docs.append(head)
                take(status)
            continue
        only = STATUS_ONLY.match(stripped)
        if only and pending:
            take(_status_name(only.group(1)))
            continue
        if DJANGO_TEST.match(stripped):
            pending = stripped
            pending_docs = []
            continue
        if pending and stripped:
            pending_docs.append(stripped)
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
        if score.get("status") != "evidence_missing" and not score.get("snapshotError"):
            score["tests"] = run_tests(arm_dir / "work", tasks, env, score)
            if any(item.get("kitError") for item in score.get("tests") or []):
                score["status"] = "invalid"
            diff = git(arm_dir / "work", "diff", f"{base}..{score.get('snapshot') or 'HEAD'}", check=False)
            (arm_dir / "final.diff").write_text(diff.stdout, encoding="utf-8")
            log = git(arm_dir / "work", "log", "--oneline", f"{base}..{score.get('snapshot') or 'HEAD'}", check=False)
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
        "kitGeneration": generation_metadata(Path(__file__).resolve().parents[1]),
        "winClaim": False,
        "status": overall,
        "mode": env.get("PREREG_SMOKE_MODE"),
        "commonBase": base,
        "boundary": (arms.get("B") or {}).get("boundary"),
        "boundaryMechanism": (arms.get("B") or {}).get("boundaryMechanism"),
        "testIdNormalization": tasks.get("testIdNormalization"),
        "overlapCondition": (env.get("PREREG_OVERLAP_CONDITION") or "").strip() or "none",
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
