#!/bin/bash
# 離線檢查：真實模型探測的 Arm B 倉庫，在每種邊界都有有效的 session-write.json。
# 不呼叫 Codex。公開 CLI 用回報 0.1.21 的 stub。沒有 0.1.21 時不得寫檔，也沒有 claim 退路。
# unix-user 走 own_worktree：session 讀得到設定，但不能寫已追蹤檔。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
PREREG_PROBE_PREPARE_ONLY=1 source "$HERE/test/test-real-model.sh"
unset PREREG_PROBE_PREPARE_ONLY

BASE="$(mktemp -d)"
UNIX_REPO=""
cleanup() {
  if [ -n "${UNIX_REPO:-}" ] && [ -d "$UNIX_REPO" ]; then
    PREREG_BOUNDARY=unix-user release_worktree "$UNIX_REPO" || true
    rm -rf "$UNIX_REPO"
  fi
  rm -rf "$BASE"
}
trap cleanup EXIT

STUB_CLI="$BASE/prefix/lib/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs"
mkdir -p "$(dirname "$STUB_CLI")"
cat > "$STUB_CLI" <<'EOF'
if (process.argv.includes("--version")) {
  process.stdout.write(JSON.stringify({evidence:{frameworkVersion:"0.1.21"}}) + "\n");
}
EOF

BAD_BIN="$BASE/badbin"
mkdir -p "$BAD_BIN" "$BASE/no-global"
cat > "$BAD_BIN/npm" <<'EOF'
#!/bin/bash
if [ "$1" = "prefix" ] && [ "$2" = "-g" ]; then
  printf '%s\n' "${FAKE_PREFIX:?}"
  exit 0
fi
echo "npm error refusing install in probe session-write test" >&2
exit 1
EOF
chmod +x "$BAD_BIN/npm"

assert_valid_config() {
  local repo="$1" mode="$2"
  local config="$repo/.prereg-smoke/session-write.json"
  [ -f "$config" ]
  local node_bin
  node_bin="$(dirname "$(command -v node)")"
  python3 - "$config" "$repo" "$STUB_CLI" "$mode" "$node_bin" <<'PY'
import json, pathlib, sys
config, repo, cli, mode, node_bin = sys.argv[1:]
payload = json.loads(pathlib.Path(config).read_text(encoding="utf-8"))
if payload.get("writableRoot") != repo:
    raise SystemExit(f"writableRoot {payload.get('writableRoot')!r} != {repo!r}")
if payload.get("cli") != cli:
    raise SystemExit(f"cli {payload.get('cli')!r} != {cli!r}")
if payload.get("cliVersion") != "0.1.21":
    raise SystemExit(f"cliVersion {payload.get('cliVersion')!r}")
if payload.get("boundary") != mode:
    raise SystemExit(f"boundary {payload.get('boundary')!r} != {mode!r}")
if payload.get("safePath") != f"{node_bin}:/usr/bin:/bin":
    raise SystemExit(f"safePath {payload.get('safePath')!r}")
if payload.get("composeWindowMs") != 4000:
    raise SystemExit(f"composeWindowMs {payload.get('composeWindowMs')!r}")
PY
  local patch out err status
  patch="$BASE/note.patch"
  cat > "$patch" <<'EOF'
diff --git a/note.txt b/note.txt
--- a/note.txt
+++ b/note.txt
@@ -1,1 +1,1 @@
-old
+new
EOF
  set +e
  out="$(env -u PREREG_STEWARD_SOCK "$HERE/bin/atm-write" note.txt "$patch" --cwd "$repo" 2>"$BASE/atm-write.err")"
  status=$?
  set -e
  err="$(cat "$BASE/atm-write.err" 2>/dev/null || true)"
  if [ "$status" -eq 2 ] || printf '%s\n%s\n' "$out" "$err" | grep -q '缺少 session-write.json\|"code":"cli-unavailable"'; then
    echo "session-write.json 沒有讓 atm-write 通過 0.1.21 檢查 (${mode}, exit ${status})" >&2
    printf '%s\n' "$out" >&2
    printf '%s\n' "$err" >&2
    exit 1
  fi
}

assert_unix_user_ownership() {
  local repo="$1"
  local config="$repo/.prereg-smoke/session-write.json"
  [ "$(stat -c %U "$config")" = "$STEWARD_USER" ]
  [ "$(stat -c %U "$repo/note.txt")" = "$STEWARD_USER" ]
  local bits
  bits="$(stat -c %a "$repo/note.txt")"
  case "${bits: -1}" in
    0|1|4|5) ;;
    *) echo "已追蹤檔其他人仍可寫：${bits}" >&2; exit 1 ;;
  esac
  local text
  text="$(as_root -u "$SESSION_USER" -- cat "$config")"
  printf '%s\n' "$text" | grep -q '"cliVersion": "0.1.21"'
  printf '%s\n' "$text" | grep -q '"boundary": "unix-user"'
  set +e
  as_root -u "$SESSION_USER" -- bash -c 'printf leaked >> "$1"' bash "$repo/note.txt" \
    >"$BASE/tracked.out" 2>"$BASE/tracked.err"
  local status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "session 寫入了已追蹤檔" >&2
    exit 1
  fi
  if grep -q leaked "$repo/note.txt"; then
    echo "已追蹤檔被 session 改掉" >&2
    exit 1
  fi
  set +e
  as_root -u "$SESSION_USER" -- bash -c 'printf x >> "$1"' bash "$config" \
    >"$BASE/config-write.out" 2>"$BASE/config-write.err"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "session 改寫了 session-write.json" >&2
    exit 1
  fi
}

calls="$(grep -c 'prepare_probe_arm_b' "$HERE/test/test-real-model.sh")"
[ "$calls" -ge 2 ]
grep -q 'write_session_write_config' "$HERE/lib/run-arm.sh"
grep -q 'write_session_write_config "$repo"' "$HERE/test/test-real-model.sh"

bad_repo="$(mktemp -d "$BASE/bad.XXXXXX")"
prepare_probe_repo "$bad_repo"
set +e
(
  unset PREREG_ATM_CLI
  export PREREG_SKIP_CLI_SEED=1
  export PREREG_ATM_CLI_ROOT="$BASE/empty-cli-root"
  export FAKE_PREFIX="$BASE/no-global"
  export PATH="$BAD_BIN:$PATH"
  prepare_probe_arm_b "$bad_repo" codex-landlock
) >"$BASE/bad.out" 2>"$BASE/bad.err"
bad_status=$?
set -e
if [ "$bad_status" -eq 0 ]; then
  echo "沒有 0.1.21 時仍然寫入了探測設定" >&2
  exit 1
fi
if [ -f "$bad_repo/.prereg-smoke/session-write.json" ]; then
  echo "CLI 確認失敗之後仍留下 session-write.json" >&2
  exit 1
fi
grep -q '沒有 claim 退路' "$BASE/bad.err"

export PREREG_ATM_CLI="$STUB_CLI"
export PREREG_SKIP_CLI_SEED=1
export PREREG_ATM_CLI_ROOT="$BASE/prefix"
unset PREREG_BOUNDARY || true

for mode in unix-user codex-landlock bwrap-ro; do
  # 直接放在 /tmp。包在 700 的暫存目錄裡時，session 連路徑都走不進去。
  repo="$(mktemp -d)"
  if [ "$mode" = "unix-user" ]; then
    UNIX_REPO="$repo"
  fi
  prepare_probe_repo "$repo"
  prepare_probe_arm_b "$repo" "$mode"
  assert_valid_config "$repo" "$mode"
  if [ "$mode" = "unix-user" ]; then
    assert_unix_user_ownership "$repo"
    release_worktree "$repo"
    UNIX_REPO=""
  fi
  rm -rf "$repo"
  echo "probe session-write ok ${mode}"
done

echo "probe session-write ok"
