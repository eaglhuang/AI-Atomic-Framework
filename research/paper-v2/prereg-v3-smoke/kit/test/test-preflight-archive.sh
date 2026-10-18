#!/bin/bash
# All probe calls below use the offline fake Codex/daemon harness.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(mktemp -d)"
cleanup_archive_test() {
  local status=$?
  if [ "$status" != 0 ] || [ "${KEEP_TMP:-0}" = 1 ]; then
    echo "archive test retained: $BASE (exit=$status)" >&2
    if [ "$status" != 0 ]; then
      for log in "$BASE"/*.log; do
        [ ! -f "$log" ] || { echo "log: $log" >&2; tail -n 60 "$log" >&2; }
      done
    fi
  else
    rm -rf "$BASE"
  fi
}
trap cleanup_archive_test EXIT
# A log must be complete when the driver returns, without an asynchronous tee.
(
  PREREG_PROBE_PREPARE_ONLY=1 source "$HERE/test/test-real-model.sh"
  export PREREG_PREFLIGHT_LOG_ROOT="$BASE/sync-proof"
  unset PREREG_PREFLIGHT_RUN_DIR || true
  run_real_attempt() { printf 'complete before return\n'; PROBE_RETRY_NEEDED=0; }
  run_real_exec A ''
  grep -qx 'complete before return' "$PREREG_PREFLIGHT_RUN_DIR/arm-A/attempt-1/attempt.log"
)
export PREREG_PROBE_EVIDENCE_EXPORT="$BASE/preflight"
bash "$HERE/test/test-probe-retry.sh" > "$BASE/probes.log" 2>&1
python3 - "$BASE/preflight" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]);runs=list(root.glob('run-*'));assert runs
records=[]
for run in runs:
    policy=json.loads((run/'retry-policy.json').read_text())
    assert policy['maxAttemptsPerArm']==2 and policy['retryOnly']=='missing-begin-marker'
    for arm in ('A','B'):
        attempts=list((run/f'arm-{arm}').glob('attempt-*'))
        assert len(attempts)<=2
        for attempt in attempts:
            assert (attempt/'attempt.log').is_file()
            row=json.loads((attempt/'probe-result.json').read_text());records.append(row)
            if row['model_started']:
                assert (attempt/'stdout.jsonl').is_file()
                assert (attempt/'exit-code').is_file()
assert any(r['reason']=='missing-begin-marker' and r['attempt']==2 for r in records)
assert any(r['reason']=='ok' and r['attempt']==2 for r in records)
assert any(r['reason']=='path-resolution' and not r['model_started'] for r in records)
assert any(r['reason']=='quota' for r in records)
print('every offline attempt and policy retained')
PY
mkdir -p "$BASE/state"
printf 'export PREREG_SMOKE_MODE=fixture\nexport COMMON_BASE=offline-test-base\n' > "$BASE/state/env.sh"
printf '{"status":"ok"}\n' > "$BASE/state/results.json"
export PREREG_SMOKE_STATE="$BASE/state" PREREG_SMOKE_MODE=fixture
export PREREG_PREFLIGHT_LOG_ROOT="$BASE/preflight"
run="$(find "$BASE/preflight" -mindepth 1 -maxdepth 1 -type d | sort | head -1)"
printf 'excluded login data\n' > "$run/auth.json"
bash "$HERE/seal.sh" --dest "$BASE/archive" > "$BASE/seal.log" 2>&1
python3 - "$BASE/preflight" "$BASE/archive" <<'PY'
import hashlib,pathlib,sys
src,dest=map(pathlib.Path,sys.argv[1:]);manifest=(dest/'SHA256SUMS').read_text()
for p in src.rglob('*'):
    if not p.is_file() or p.name=='auth.json':continue
    q=dest/'logs/preflight'/p.relative_to(src)
    assert q.is_file() and q.read_bytes()==p.read_bytes(),p
    assert hashlib.sha256(q.read_bytes()).hexdigest() in manifest,q
assert not list(dest.rglob('auth.json'))
print('archive preserves preflight attempts/policies with checksums and excludes auth')
PY
# Existing secret filtering must also cover the newly archived preflight logs.
printf 'refresh_token=planted-test-value\n' > "$run/preflight.log"
status=0
bash "$HERE/seal.sh" --dest "$BASE/rejected" > "$BASE/rejected.log" 2>&1 || status=$?
[ "$status" != 0 ]
[ ! -e "$BASE/rejected" ]
echo 'preflight archive secret negative passed'
