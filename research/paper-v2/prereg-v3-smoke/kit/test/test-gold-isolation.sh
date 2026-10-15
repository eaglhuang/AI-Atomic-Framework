#!/bin/bash
# 工作階段的 env 與 workspace 不得含有金標路徑或金標內容。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"

CANARY="PREREG_GOLD_CANARY_DO_NOT_LEAK_9f3a"
ROOT="$(mktemp -d)"
GOLD="$ROOT/gold"
WORK="$ROOT/work"
SESSION="$ROOT/session"
mkdir -p "$GOLD" "$WORK" "$SESSION"
printf 'alpha\nbeta\n' > "$WORK/shared.py"
printf '%s\n' "$CANARY" > "$GOLD/secret.patch"
cat > "$ROOT/probe.mjs" <<'EOF'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const session = process.env.PREREG_SESSION_DIR;
const work = process.env.PREREG_WORK;
const lines = Object.entries(process.env).map(([key, value]) => `${key}=${value}`);
writeFileSync(path.join(session, 'probe-env.txt'), `${lines.join('\n')}\n`);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const child = path.join(dir, name);
    files.push(child);
    try {
      if (readdirSync(child)) walk(child);
    } catch {
      // 檔案
    }
  }
}
try { walk(work); } catch { /* 空目錄 */ }
let blob = '';
for (const file of files) {
  try { blob += `\n${file}\n${readFileSync(file, 'utf8')}`; } catch { /* 目錄 */ }
}
writeFileSync(path.join(session, 'probe-work.txt'), blob);
writeFileSync(path.join(session, 'agent-output.diff'), 'diff --git a/shared.py b/shared.py\n--- a/shared.py\n+++ b/shared.py\n@@ -1 +1 @@\n-alpha\n+alpha\n');
EOF

export PREREG_SMOKE_CODEX="$ROOT/probe.mjs"
export PREREG_ARM=A
export PREREG_INSTANCE_ID=fixture-session-one
export PREREG_SESSION_SLOT=1
export PREREG_GOLD_PATCH="$GOLD/secret.patch"
export GOLD_ROOT="$GOLD"
export KIT_ROOT_SENTINEL="$HERE/gold"
printf 'solve the marker\n' > "$SESSION/prompt.txt"
launch_codex "$SESSION" "$SESSION/prompt.txt" "$WORK"

python3 - "$CANARY" "$GOLD" "$SESSION/launch-env.txt" "$SESSION/probe-env.txt" "$SESSION/probe-work.txt" "$WORK" <<'PY'
import pathlib, sys
canary, gold, launch_env, probe_env, probe_work, work = sys.argv[1:]
blobs = [
    pathlib.Path(launch_env).read_text(encoding="utf-8"),
    pathlib.Path(probe_env).read_text(encoding="utf-8"),
    pathlib.Path(probe_work).read_text(encoding="utf-8"),
]
for blob in blobs:
    assert canary not in blob, blob
    assert "PREREG_GOLD_PATCH" not in blob, blob
    assert gold not in blob, blob
    assert "GOLD_ROOT" not in blob, blob
for path in pathlib.Path(work).rglob("*"):
    if path.is_file():
        text = path.read_text(encoding="utf-8", errors="replace")
        assert canary not in text, path
        assert gold not in text, path
print("gold isolation ok")
PY
