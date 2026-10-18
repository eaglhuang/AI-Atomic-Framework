#!/bin/bash
# Archive one smoke run. This does not claim a result or a win.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"
load_state

PUBLISH=0
INDEX_EXPLICIT=0
# kit -> prereg-v3-smoke -> paper-v2/EVIDENCE_INDEX.md
INDEX_FILE="$HERE/../../EVIDENCE_INDEX.md"
while [ $# -gt 0 ]; do
  case "$1" in
    --publish-index) PUBLISH=1; shift ;;
    --index-file) INDEX_FILE="$2"; INDEX_EXPLICIT=1; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    *) die "unknown seal argument $1" ;;
  esac
done

DATE_STAMP="$(date -u +%Y-%m-%d)"
SUFFIX="codex"
if [ "${PREREG_SMOKE_MODE:-django}" = "fixture" ] || [ -n "${PREREG_SMOKE_CODEX:-}" ]; then
  SUFFIX="codex-stub"
fi
DEST="${DEST:-$HERE/../${DATE_STAMP}-${SUFFIX}}"
if [ -e "$DEST" ]; then
  die "archive already exists: $DEST"
fi
mkdir -p "$DEST/logs" "$DEST/diffs"

# 索引路徑用實際封存目錄，不用當天日期推回來的舊路徑。
archive_index_path() {
  local paper dest_abs rel
  paper="$(cd "$HERE/../.." && pwd)"
  dest_abs="$(cd "$DEST" && pwd)"
  case "$dest_abs" in
    "$paper"/*) rel="${dest_abs#"$paper"/}" ;;
    *) rel="prereg-v3-smoke/$(basename "$dest_abs")" ;;
  esac
  rel="${rel%/}/"
  printf '%s\n' "$rel"
}
INDEX_REL="$(archive_index_path)"

[ -f "$STATE_ROOT/results.json" ] || die "missing results.json. Run evaluate.sh first."
cp "$STATE_ROOT/results.json" "$DEST/results.json"
cp "$STATE_ROOT/setup-tests.log" "$DEST/logs/setup-tests.log" 2>/dev/null || true
cp "$HERE/tasks.json" "$DEST/tasks.json"
cp "$HERE/RUNBOOK.md" "$DEST/RUNBOOK.md"
copy_file() {
  local src="$1" dest="$2"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
  fi
}

# 只封這些檔。session 目錄裡的 home、tmp、codex-home、auth.json 都不進封存。
SESSION_ALLOWLIST=(
  prompt.txt
  stdout.jsonl
  stderr.txt
  intended.patch
  agent-output.diff
  started-at
  ended-at
  exit-code
  launch-env.txt
  codex-argv.txt
  QUOTA_STOP
)
for arm in a b; do
  if [ -d "$STATE_ROOT/arm-$arm" ]; then
    mkdir -p "$DEST/logs/arm-$arm" "$DEST/diffs"
    local_slot=""
    for local_slot in 1 2; do
      session_src="$STATE_ROOT/arm-$arm/session-$local_slot"
      [ -d "$session_src" ] || continue
      session_name=""
      for session_name in "${SESSION_ALLOWLIST[@]}"; do
        copy_file "$session_src/$session_name" "$DEST/logs/arm-$arm/session-$local_slot/$session_name"
      done
    done
    for session_name in meta.txt model.txt boundary.txt codex-version.txt; do
      copy_file "$STATE_ROOT/arm-$arm/$session_name" "$DEST/logs/arm-$arm/$session_name"
    done
    copy_file "$STATE_ROOT/arm-$arm/final.diff" "$DEST/diffs/arm-$arm.diff"
    copy_file "$STATE_ROOT/arm-$arm/git-log.txt" "$DEST/diffs/arm-$arm.git-log.txt"
    copy_file "$STATE_ROOT/arm-$arm/work/.prereg-smoke/steward-writes.jsonl" "$DEST/logs/arm-$arm/steward-writes.jsonl"
    copy_file "$STATE_ROOT/arm-$arm/work/.prereg-smoke/session-write.json" "$DEST/logs/arm-$arm/session-write.json"
  fi
done

# Preflight can run before setup. Copy only explicit evidence names from the
# same configured root; never copy homes, sockets or arbitrary session files.
preflight_root="${PREREG_PREFLIGHT_LOG_ROOT:-$KIT_ROOT/state/preflight}"
if [ -d "$preflight_root" ]; then
  for preflight_run in "$preflight_root"/run-*; do
    [ -d "$preflight_run" ] || continue
    preflight_dest="$DEST/logs/preflight/$(basename "$preflight_run")"
    for name in retry-policy.json preflight.log; do
      copy_file "$preflight_run/$name" "$preflight_dest/$name"
    done
    for arm in A B; do
      for attempt in 1 2; do
        for name in prompt.txt stdout.jsonl stderr.txt intended.patch probe-result.json started-at ended-at exit-code launch-env.txt codex-argv.txt QUOTA_STOP WAIT_FAILED attempt.log; do
          copy_file "$preflight_run/arm-$arm/attempt-$attempt/$name" "$preflight_dest/arm-$arm/attempt-$attempt/$name"
        done
      done
    done
  done
fi

reject_seal_secrets() {
  python3 - "$DEST" <<'PY'
import re, sys
from pathlib import Path
root = Path(sys.argv[1])
jwt = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
content_patterns = (
    # 用量統計的 "tokens" 物件不是登入檔。只擋憑證欄位、金鑰前綴與 JWT。
    ("refresh_token", re.compile(r"refresh_token")),
    ("access_token", re.compile(r"access_token")),
    ("id_token", re.compile(r"id_token")),
    ("tokens-credential", re.compile(r'"tokens"\s*:\s*\{[^}]*"(?:refresh_token|access_token|id_token)"', re.DOTALL)),
    ("sk-prefix", re.compile(r"sk-[A-Za-z0-9_-]{8,}")),
    ("jwt", jwt),
)
hits = []
for path in root.rglob("*"):
    if not path.is_file() or path.name == "SHA256SUMS":
        continue
    rel = path.relative_to(root).as_posix()
    if path.name == "auth.json" or rel.endswith("/auth.json"):
        hits.append(f"auth.json {rel}")
        continue
    data = path.read_bytes()
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="replace")
    for name, pattern in content_patterns:
        if pattern.search(text):
            hits.append(f"{name} {rel}")
if hits:
    sys.stderr.write("seal rejected secrets:\n")
    for hit in hits:
        sys.stderr.write(hit + "\n")
    raise SystemExit(1)
PY
}

if ! reject_seal_secrets; then
  rm -rf "$DEST"
  die "封存含有登入或密鑰樣式。已刪除未完成的封存，不寫入索引。"
fi

MODEL="unrecorded"
[ -f "$STATE_ROOT/arm-a/model.txt" ] && MODEL="$(head -n 1 "$STATE_ROOT/arm-a/model.txt")"
cat > "$DEST/README.md" <<EOF
# prereg-v3 smoke archive

Label: **smoke / exploratory, not results**. No win claim.

- Date (UTC): ${DATE_STAMP}
- Mode: ${PREREG_SMOKE_MODE:-django}
- Agent: ${SUFFIX}
- Model recorded: ${MODEL}
- Common base: ${COMMON_BASE}
- Tasks: \`tasks.json\` (primary pair is the only pair whose official gold patches both \`git apply --check\` on this base)
- Results: \`results.json\`

This directory is produced by \`kit/seal.sh\`. It is not a paper result.
EOF

(
  cd "$DEST"
  find . -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort | while read -r file; do
    sha256sum "$file"
  done > SHA256SUMS
)

RESULT_STATUS="$(jq -r '.status // empty' "$STATE_ROOT/results.json")"
ROW_LABEL="smoke / exploratory, not results"
if [ "$RESULT_STATUS" = "invalid" ]; then
  KIT_ERRORS="$(jq -r '[.arms[]?.tests[]?.kitError // empty] | unique | join(", ")' "$STATE_ROOT/results.json" 2>/dev/null || true)"
  if [ -n "$KIT_ERRORS" ]; then
    ROW_LABEL="smoke / exploratory, not results — INVALID (kit-error: ${KIT_ERRORS})"
  else
    ROW_LABEL="smoke / exploratory, not results — INVALID"
  fi
elif [ "$RESULT_STATUS" = "blocked" ]; then
  BLOCKED_ARMS="$(jq -r '[.arms | to_entries[] | select(.value.status == "blocked") | "arm \(.key)"] | join(", ")' "$STATE_ROOT/results.json" 2>/dev/null || true)"
  if [ -n "$BLOCKED_ARMS" ]; then
    ROW_LABEL="smoke / exploratory, not results — blocked (${BLOCKED_ARMS})"
  else
    ROW_LABEL="smoke / exploratory, not results — blocked"
  fi
fi
ROW="| \`$INDEX_REL\` | ${ROW_LABEL} | no win claim | mode=${PREREG_SMOKE_MODE:-django}; model=${MODEL}; base=${COMMON_BASE} |"
printf '%s\n' "$ROW" > "$DEST/EVIDENCE_INDEX_ROW.md"
if [ "$PUBLISH" -eq 1 ]; then
  if [ "$INDEX_EXPLICIT" -eq 0 ] && [ ! -f "$INDEX_FILE" ]; then
    die "evidence index not found: $INDEX_FILE"
  fi
  mkdir -p "$(dirname "$INDEX_FILE")"
  if [ ! -e "$INDEX_FILE" ]; then
    : > "$INDEX_FILE"
  fi
  if ! grep -Fq -- "$ROW" "$INDEX_FILE"; then
    # 檔尾沒有換行時先補一行，然後只追加這一列。同一列已在索引裡就不再加。
    if [ -s "$INDEX_FILE" ] && [ -n "$(tail -c 1 "$INDEX_FILE")" ]; then
      printf '\n' >> "$INDEX_FILE"
    fi
    printf '%s\n' "$ROW" >> "$INDEX_FILE"
  fi
fi

echo "sealed $DEST"
echo "row: $ROW"
