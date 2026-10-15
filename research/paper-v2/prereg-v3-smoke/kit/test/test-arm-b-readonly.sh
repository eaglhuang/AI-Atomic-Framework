#!/bin/bash
# 直接寫入唯讀工作樹必須失敗；公開 CLI 0.1.20 steward 寫入必須成功。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/common.sh"
CLI="$(require_public_cli)"
ROOT="$(mktemp -d)"
printf 'alpha\nbeta\ngamma\n' > "$ROOT/shared.py"
git -C "$ROOT" init -q
git -C "$ROOT" add shared.py
git -C "$ROOT" -c user.name=prereg-smoke -c user.email=prereg-smoke@localhost commit -q -m base
mkdir -p "$ROOT/.prereg-smoke"
NODE_BIN="$(dirname "$(command -v node)")"
python3 - "$ROOT/.prereg-smoke/session-write.json" "$ROOT" "$CLI" "$NODE_BIN" <<'PY'
import json, sys
dest, work, cli, node_bin = sys.argv[1:]
open(dest, "w", encoding="utf-8").write(json.dumps({
    "writableRoot": work,
    "cli": cli,
    "cliVersion": "0.1.20",
    "safePath": f"{node_bin}:/usr/bin:/bin",
    "composeWindowMs": 200,
    "readonly": True,
}) + "\n")
PY
make_worktree_readonly "$ROOT"
set +e
echo leaked >> "$ROOT/shared.py" 2>/dev/null
DIRECT=$?
set -e
[ "$DIRECT" -ne 0 ]
PATCH="$ROOT/.prereg-smoke/one.patch"
cat > "$PATCH" <<'EOF'
diff --git a/shared.py b/shared.py
--- a/shared.py
+++ b/shared.py
@@ -2,1 +2,1 @@
-beta
+beta-one
EOF
chmod u+w "$ROOT/.prereg-smoke"
PATH="${NODE_BIN}:$HERE/bin:/usr/bin:/bin" "$HERE/bin/atm-write" shared.py "$PATCH" --actor session-b --task fixture-b --cwd "$ROOT"
grep -q 'beta-one' "$ROOT/shared.py"
set +e
echo leaked >> "$ROOT/shared.py" 2>/dev/null
AFTER=$?
set -e
[ "$AFTER" -ne 0 ]
echo "readonly steward ok"
