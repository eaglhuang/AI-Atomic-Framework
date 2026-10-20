#!/bin/bash
# 阻斷檢查。任何一項失敗就立刻停止，不跑後面的檢查，也不啟動真實 A/B。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# Fail before any checks that could prepare a model session.
if [ "${PREFLIGHT_REAL_MODEL:-}" = "1" ]; then
  source "$HERE/lib/common.sh"
  init_preflight_evidence
  exec {PREFLIGHT_STDOUT}>&1
  exec >> "$PREREG_PREFLIGHT_RUN_DIR/preflight.log" 2>&1
  flush_preflight_log() {
    local status=$?
    cat "${REAL_PREFLIGHT_RUN_DIR:-$PREREG_PREFLIGHT_RUN_DIR}/preflight.log" >&"$PREFLIGHT_STDOUT"
    exec {PREFLIGHT_STDOUT}>&-
    return "$status"
  }
  trap flush_preflight_log EXIT
  require_probe_python
  # Offline checks must not inherit the live real-model run: nested preflight/seal tests
  # would otherwise write into, or archive, this run's preflight.log (v10 launch, 2026-10-19).
  REAL_PREFLIGHT_RUN_DIR="$PREREG_PREFLIGHT_RUN_DIR"
  REAL_PREFLIGHT_LOG_ROOT="${PREREG_PREFLIGHT_LOG_ROOT:-$KIT_ROOT/state/preflight}"
  OFFLINE_PREFLIGHT_SCRATCH="$(mktemp -d)"
  unset PREFLIGHT_REAL_MODEL PREREG_PREFLIGHT_RUN_DIR
  export PREREG_PREFLIGHT_LOG_ROOT="$OFFLINE_PREFLIGHT_SCRATCH/offline-checks"
  REAL_MODEL_REQUESTED=1
fi

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
  grep -q 'json.loads' "$HERE/lib/common.sh"
  grep -q 'wait_for_steward_accept' "$HERE/lib/common.sh"
  grep -q 'KIT_ROOT}/bin' "$HERE/lib/common.sh"
  grep -q 'bin/atm-write' "$HERE/lib/run-arm.sh"
  if grep -q '## prereg-v3 smoke' "$HERE/seal.sh"; then
    echo "seal 仍會在索引裡另開小節" >&2
    return 1
  fi
  if grep -n 'exits 3, stop' "$HERE/lib/run-arm.sh"; then
    echo "提示詞仍要求 steward 拒絕後停止，重送次數會永遠是 0" >&2
    return 1
  fi
  grep -q 'currentFileText' "$HERE/lib/run-arm.sh"
  grep -q 'currentFileText' "$HERE/bin/atm-write.mjs"
  grep -q 'rejected-by-design' "$HERE/bin/evaluate.py"
  grep -q 'kit-error' "$HERE/bin/evaluate.py"
  grep -q 'retries-exhausted' "$HERE/bin/stub-codex.mjs"
  grep -q 'install_task_repo_into_venv' "$HERE/setup.sh"
  grep -q 'pick_python' "$HERE/setup.sh"
  grep -q 'django_venv_preflight' "$HERE/setup.sh"
  grep -q 'pass_to_pass_baseline_failed' "$HERE/setup.sh"
  grep -q 'django_pass_to_pass_labels' "$HERE/setup.sh"
  grep -q -- '--parallel 1' "$HERE/setup.sh"
  grep -q 'pass_to_pass_baseline_failed' "$HERE/lib/django-venv.sh"
  grep -q 'django_runner_failed' "$HERE/lib/django-venv.sh"
  grep -q -- '--parallel", "1"' "$HERE/bin/evaluate.py"
  grep -q 'discard_model_test_edits' "$HERE/bin/evaluate.py"
  grep -q 'apply_gold_test_patch' "$HERE/bin/evaluate.py"
  grep -q 'resetTestPatchPaths' "$HERE/bin/evaluate.py"
  if grep -q -- '--fuzz=5' "$HERE/bin/evaluate.py" "$HERE/setup.sh"; then
    echo "金標測試 patch 仍用 fuzz 套用" >&2
    return 1
  fi
  grep -q 'modelTestEditsDiscarded' "$HERE/bin/evaluate.py"
  grep -q 'def session_rejected' "$HERE/bin/evaluate.py"
  grep -q 'INVALID' "$HERE/seal.sh"
  grep -q 'ensure_setuptools' "$HERE/lib/django-venv.sh"
  grep -q -- '--no-deps' "$HERE/lib/django-venv.sh"
  grep -q 'pick_python' "$HERE/test/test-setup-django-venv.sh"
  if grep -q 'PREREG_PYTHON="$(command -v python3)"' "$HERE/test/test-setup-django-venv.sh"; then
    echo "django venv 測試仍把 PREREG_PYTHON 指到系統 python3" >&2
    return 1
  fi
  grep -q 'def recompose_or_retry' "$HERE/bin/evaluate.py"
  grep -q 'def freeze_worktree_snapshot' "$HERE/bin/evaluate.py"
  grep -q 'evaluator-snapshot-failed' "$HERE/bin/evaluate.py"
  if grep -q 'stdout.count("index.lock")' "$HERE/bin/evaluate.py"; then
    echo "index.lock 仍用 stdout 字串計數" >&2
    return 1
  fi
  grep -q 'test-patch-not-applied' "$HERE/bin/evaluate.py"
  grep -q 'tests-unobserved' "$HERE/bin/evaluate.py"
  grep -q 'denominator-unobserved' "$HERE/bin/evaluate.py"
  grep -q 'archive_index_path' "$HERE/seal.sh"
  grep -q 'prepare_session_codex_runtime_dirs' "$HERE/lib/common.sh"
  grep -q 'write_session_write_config' "$HERE/lib/common.sh"
  grep -q 'write_session_write_config' "$HERE/lib/run-arm.sh"
  grep -q 'write_session_write_config' "$HERE/test/test-real-model.sh"
  grep -q 'prepare_probe_arm_b' "$HERE/test/test-real-model.sh"
  if grep -n 'composeWindowMs' "$HERE/lib/run-arm.sh" "$HERE/test/test-real-model.sh" "$HERE/test/test-arm-b-readonly.sh"; then
    echo "session-write.json 仍有第二份寫入" >&2
    return 1
  fi
  grep -q 'select_run_boundary' "$HERE/lib/common.sh"
  grep -q 'select_run_boundary' "$HERE/lib/run-arm.sh"
  grep -q 'select_run_boundary' "$HERE/test/test-real-model.sh"
  grep -q 'is_codex_runtime_path' "$HERE/bin/evaluate.py"
  grep -q '0.163.0' "$HERE/RUNBOOK.md"
  grep -q 'writable_roots' "$HERE/lib/common.sh"
  grep -q 'evaluator_python_bin' "$HERE/lib/common.sh"
  grep -q 'a-no-commit' "$HERE/test/test-real-model.sh"
  grep -q 'or "none"' "$HERE/bin/evaluate.py"
  grep -q 'BASH_ENV' "$HERE/lib/common.sh"
  grep -q 'git-forward' "$HERE/lib/common.sh"
  grep -q 'assert_session_login_path' "$HERE/test/test-real-model.sh"
  grep -q 'write-not-applied' "$HERE/bin/atm-write.mjs"
  grep -q 'def false_accept_row' "$HERE/bin/evaluate.py"
  grep -q 'session_rows_by_proposal' "$HERE/bin/evaluate.py"
  grep -q 'PREREG_BOUNDARY' "$HERE/RUNBOOK.md"
  if grep -q 'each boundary mode' "$HERE/test/test-real-model.sh" "$HERE/RUNBOOK.md"; then
    echo "真實模型探測仍會跑每一種邊界" >&2
    return 1
  fi
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
check v4-regressions python3 "$HERE/test/test_v4_regressions.py"
check v5-regressions python3 "$HERE/test/test_v5_regressions.py"
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
check django-venv bash "$HERE/test/test-setup-django-venv.sh"
check observation python3 "$HERE/test/test_observation_kit_error.py"
check blocked-edits python3 "$HERE/test/test_blocked_edits.py"
check snapshot-uncommitted python3 "$HERE/test/test_snapshot_uncommitted.py"
check v7-records python3 "$HERE/test/test_v7_records.py"
check v8-records python3 "$HERE/test/test_v8_records.py"
check arm-a-git bash "$HERE/test/test-arm-a-git-writable.sh"
check login-path bash "$HERE/test/test-session-login-path.sh"
check false-accept bash "$HERE/test/test-false-accept.sh"
check seal-index bash "$HERE/test/test-seal-index.sh"
check overlap bash "$HERE/test/test-overlap-decision.sh"
check stale-overlap bash "$HERE/test/test-stale-overlap.sh"
check stale-base-declared bash "$HERE/test/test-stale-base-declared.sh"
check hunk-locator-parity bash "$HERE/test/test-hunk-locator-parity.sh"
check atm-write-malformed bash "$HERE/test/test-atm-write-malformed.sh"
check overlap-condition bash "$HERE/test/test-overlap-condition.sh"
check stub-dry-run bash "$HERE/self-check.sh"
check capture-intended bash "$HERE/test/test-capture-intended.sh"
check seal-one-row bash "$HERE/test/test-seal-one-row.sh"
check steward-ready bash "$HERE/test/test-steward-ready.sh"
check probe-session-write bash "$HERE/test/test-probe-session-write.sh"
check probe-retry bash "$HERE/test/test-probe-retry.sh"
check metrics-evidence python3 "$HERE/test/test_metrics_evidence.py"
check session-slot bash "$HERE/test/test-session-slot.sh"
check preflight-archive bash "$HERE/test/test-preflight-archive.sh"
check cross-owner-git bash "$HERE/test/test-probe-cross-owner-git.sh"
# #354 regression: runs preflight in real-model mode with an empty CODEX_HOME (no model call).
# The nested run sets PREREG_REAL_MODE_ISOLATION_TEST, so it does not recurse.
if [ -z "${PREREG_REAL_MODE_ISOLATION_TEST:-}" ]; then
  check real-mode-isolation bash "$HERE/test/test-preflight-real-mode-isolation.sh"
fi
if [ "${REAL_MODEL_REQUESTED:-}" = "1" ]; then
  check real-model env PREFLIGHT_REAL_MODEL=1 PREREG_PREFLIGHT_RUN_DIR="$REAL_PREFLIGHT_RUN_DIR" PREREG_PREFLIGHT_LOG_ROOT="$REAL_PREFLIGHT_LOG_ROOT" bash "$HERE/test/test-real-model.sh"
else
  check real-model bash "$HERE/test/test-real-model.sh"
fi
check real-model-skip bash "$HERE/test/test-real-model-skip.sh"
echo "preflight ok"
