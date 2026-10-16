#!/bin/bash
# 阻斷檢查。任何一項失敗就立刻停止，不跑後面的檢查，也不啟動真實 A/B。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

check() {
  local name="$1"
  shift
  echo "== ${name}"
  if "$@"; then
    echo "ok ${name}"
  else
    echo "FAIL ${name}" >&2
    echo "preflight failed" >&2
    exit 1
  fi
}

if [ "${1:-}" = "--fail-fast-self-test" ]; then
  check should-fail false
  echo "reached-next" >&2
  exit 0
fi

static_launchers() {
  if grep -nE 'PREREG_GOLD_PATCH=' "$HERE/lib/run-arm.sh" "$HERE/lib/common.sh"; then
    echo "launcher 仍把 PREREG_GOLD_PATCH 傳進工作階段" >&2
    return 1
  fi
  grep -q 'env -i' "$HERE/lib/common.sh"
  grep -q 'readlink -f' "$HERE/bin/atm-write"
  grep -q 'evidence_missing' "$HERE/bin/evaluate.py"
  grep -q -- '--verbosity", "2"' "$HERE/bin/evaluate.py"
  grep -q 'broker steward apply-live' "$HERE/bin/atm-write.mjs"
  grep -q '0.1.21' "$HERE/bin/atm-write.mjs"
  if grep -nE 'packages/core/src|shared-compose-inbox' "$HERE/bin/atm-write.mjs"; then
    echo "atm-write 仍直接載入 TypeScript" >&2
    return 1
  fi
  if grep -nE 'taskflow claim|broker claim' "$HERE/lib/run-arm.sh" "$HERE/bin/atm-write.mjs"; then
    echo "Arm B 仍有 claim 退路" >&2
    return 1
  fi
  if grep -nE 'rm[[:space:]]+-rf' "$HERE/setup.sh" "$HERE/lib/run-arm.sh"; then
    echo "setup 或 launcher 仍會刪除 state" >&2
    return 1
  fi
  if grep -n 'make_worktree_readonly' "$HERE/lib/run-arm.sh" "$HERE/lib/common.sh"; then
    echo "Arm B 仍把 chmod 當成寫入邊界" >&2
    return 1
  fi
  grep -q 'prereg-steward' "$HERE/lib/common.sh"
  grep -q 'PREREG_STEWARD_SOCK' "$HERE/lib/common.sh"
  grep -q 'PREREG_STEWARD_SOCK' "$HERE/bin/atm-write.mjs"
  grep -q 'read-only' "$HERE/lib/common.sh"
  grep -q 'codex-landlock' "$HERE/lib/sandbox-boundary.sh"
  grep -q 'bwrap-ro' "$HERE/lib/sandbox-boundary.sh"
  grep -q 'approval_policy="never"' "$HERE/lib/common.sh"
  grep -q 'model_reasoning_effort' "$HERE/lib/common.sh"
  grep -q 'CODEX_REASONING_EFFORT' "$HERE/lib/common.sh"
  grep -q 'reasoningEffort' "$HERE/bin/evaluate.py"
  grep -q 'ignore-user-config' "$HERE/lib/common.sh"
  grep -q 'prepare_session_codex_home' "$HERE/lib/common.sh"
  grep -q 'release_session_codex_home' "$HERE/lib/common.sh"
  grep -q 'CODEX_HOME=' "$HERE/lib/common.sh"
  grep -q '/tmp/prereg-sbx' "$HERE/lib/common.sh"
  grep -q 'prefer-offline' "$HERE/lib/common.sh"
  grep -q 'EAI_AGAIN' "$HERE/lib/common.sh"
  grep -q 'codex-daemon-' "$HERE/lib/sandbox-boundary.sh"
  grep -q 'reject_seal_secrets' "$HERE/seal.sh"
  if grep -n 'cp -a "\$STATE_ROOT/arm-' "$HERE/seal.sh"; then
    echo "seal 仍整份複製 session 目錄" >&2
    return 1
  fi
  if grep -n 'dangerously-bypass-approvals-and-sandbox' "$HERE/lib/common.sh" "$HERE/lib/sandbox-boundary.sh"; then
    echo "launcher 仍把 bypass 放進邊界" >&2
    return 1
  fi
  test -f "$HERE/bin/steward-daemon.mjs"
  grep -q 'capture_intended_patch' "$HERE/lib/run-arm.sh"
  if grep -n 'exits 3, stop' "$HERE/lib/run-arm.sh"; then
    echo "提示詞仍要求 steward 拒絕後停止，重送次數會永遠是 0" >&2
    return 1
  fi
  grep -q 'currentFileText' "$HERE/lib/run-arm.sh"
  grep -q 'currentFileText' "$HERE/bin/atm-write.mjs"
  grep -q 'rejected-by-design' "$HERE/bin/evaluate.py"
  grep -q 'kit-error' "$HERE/bin/evaluate.py"
  grep -q 'retries-exhausted' "$HERE/bin/stub-codex.mjs"
}

echo "== static"
if static_launchers; then
  echo "ok static"
else
  echo "FAIL static" >&2
  echo "preflight failed" >&2
  exit 1
fi
check parser python3 "$HERE/test/test_evaluate_parser.py"
check evidence python3 "$HERE/test/test_evidence_missing.py"
check seal-secrets bash "$HERE/test/test-seal-secrets.sh"
check public-cli bash "$HERE/test/test-public-cli.sh"
check fail-fast bash "$HERE/test/test-preflight-fail-fast.sh"
check reasoning-effort bash "$HERE/test/test-reasoning-effort.sh"
check no-rm bash "$HERE/test/test-no-rm-state.sh"
check gold bash "$HERE/test/test-gold-isolation.sh"
check atm-write-path bash "$HERE/test/test-atm-write-path.sh"
check readonly-steward bash "$HERE/test/test-arm-b-readonly.sh"
check exec-boundary bash "$HERE/test/test-arm-b-exec-boundary.sh"
check disposition python3 "$HERE/test/test_write_disposition.py"
check overlap bash "$HERE/test/test-overlap-decision.sh"
check stub-dry-run bash "$HERE/self-check.sh"
echo "preflight ok"
