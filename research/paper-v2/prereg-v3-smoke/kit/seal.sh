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
[ -f "$STATE_ROOT/arm-a/model.txt" ] && MODEL="$(cat "$STATE_ROOT/arm-a/model.txt")"
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

ROW="| \`prereg-v3-smoke/${DATE_STAMP}-${SUFFIX}/\` | smoke / exploratory, not results | no win claim | mode=${PREREG_SMOKE_MODE:-django}; model=${MODEL}; base=${COMMON_BASE} |"
printf '%s\n' "$ROW" > "$DEST/EVIDENCE_INDEX_ROW.md"
if [ "$PUBLISH" -eq 1 ]; then
  if [ "$INDEX_EXPLICIT" -eq 0 ] && [ ! -f "$INDEX_FILE" ]; then
    die "evidence index not found: $INDEX_FILE"
  fi
  if ! grep -q "prereg-v3-smoke/${DATE_STAMP}-${SUFFIX}" "$INDEX_FILE" 2>/dev/null; then
    mkdir -p "$(dirname "$INDEX_FILE")"
    {
      echo
      echo "## prereg-v3 smoke ${DATE_STAMP}-${SUFFIX}"
      echo
      echo "> **smoke / exploratory, not results.** No win claim. Produced by \`kit/seal.sh --publish-index\`."
      echo
      echo "| Path | Label | Claim | Notes |"
      echo "|---|---|---|---|"
      echo "$ROW"
    } >> "$INDEX_FILE"
  fi
fi

echo "sealed $DEST"
echo "row: $ROW"
