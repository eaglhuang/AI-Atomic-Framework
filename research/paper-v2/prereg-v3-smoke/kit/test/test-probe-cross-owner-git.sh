#!/bin/bash
# #356 regression: under unix-user, the real-model probe hands Arm B's repo to
# prereg-steward before the launcher reads it (base sha, inspect_probe_attempt).
# Plain launcher-side git refuses a repo owned by another user ("dubious
# ownership"). This test owns a probe repo by the steward user for real, shows
# that plain git fails (negative control), and that the probe helpers succeed.
# No Codex, no model call. Needs passwordless sudo; otherwise it says so and skips.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
PREREG_PROBE_PREPARE_ONLY=1 source "$HERE/test/test-real-model.sh"
unset PREREG_PROBE_PREPARE_ONLY

if ! sudo -n true >/dev/null 2>&1 || [ -n "${PREREG_DISABLE_SUDO:-}" ]; then
  echo "skipped cross-owner-git: no passwordless sudo, so no second user to own the repo"
  exit 0
fi

# Operator git config must not decide the result (a global safe.directory=* would hide the bug).
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 || true

BASE="$(mktemp -d)"
chmod 755 "$BASE"
REPO="$BASE/repo"
SESSION="$BASE/session"
cleanup() {
  PREREG_BOUNDARY=unix-user release_worktree "$REPO" || true
  rm -rf "$BASE"
}
trap cleanup EXIT

export PREREG_BOUNDARY=unix-user
ensure_prereg_users
prepare_probe_repo "$REPO"
base="$(git -C "$REPO" rev-parse HEAD)"
own_worktree "$REPO"
owner="$(stat -c %U "$REPO/.git")"
[ "$owner" = "$STEWARD_USER" ] || die "probe repo .git owner is ${owner}, expected ${STEWARD_USER}"

# Negative control: this is exactly what killed v10b's Arm B probe.
if out="$(git -C "$REPO" rev-parse HEAD 2>&1)"; then
  die "plain git read a repo owned by ${STEWARD_USER}; the negative control did not reproduce #356"
fi
grep -q 'dubious ownership' <<<"$out" || die "plain git failed for another reason: $out"
echo "negative control: plain launcher git refuses the steward-owned repo"


# Steward makes the Arm A-shaped change + commit; the launcher then inspects it while the
# repo is still steward-owned (same order as run_real_attempt: inspect before finish_probe_steward).
as_root -u "$STEWARD_USER" -- bash -c 'cd "$1" && printf "new\n" > note.txt && git -c user.name=s -c user.email=s@localhost commit -qam probe' bash "$REPO"
mkdir -p "$SESSION"
printf '0\n' > "$SESSION/exit-code"
cat > "$SESSION/intended.patch" <<'PATCH'
diff --git a/note.txt b/note.txt
--- a/note.txt
+++ b/note.txt
@@ -1 +1 @@
-old
+new
PATCH
python3 - "$SESSION/intended.patch" "$SESSION/stdout.jsonl" <<'PY'
import json, sys
patch = open(sys.argv[1]).read()
text = "BEGIN_INTENDED_PATCH\n" + patch + "END_INTENDED_PATCH"
with open(sys.argv[2], "w") as fh:
    fh.write(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": text}}) + "\n")
PY
result="$(inspect_probe_attempt A "$REPO" "$SESSION" "$base" 1)" || die "inspect_probe_attempt failed on a steward-owned repo (#356)"
# Do not echo the raw "probe-result" line: real-mode-isolation treats it as a started probe.
echo "inspect_probe_attempt: ${result#probe-result }" | sed "s/^/  /"
python3 - "$SESSION/probe-result.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert r["reason"] == "ok", r
assert r["committed"] is True and r["changed"] is True, r
PY
[ "$(stat -c %U "$REPO/.git")" = "$STEWARD_USER" ] || die "inspection changed repo ownership"
type probe_git >/dev/null 2>&1 || die "test-real-model.sh has no probe_git helper for the base sha (#356)"
[ "$(probe_git "$REPO" rev-parse HEAD^)" = "$base" ] || die "probe_git rev-parse did not reach the base sha"
echo "probe_git reads the steward-owned repo"
git config --global --get-all safe.directory >/dev/null 2>&1 && die "test wrote global safe.directory" || true
echo "cross-owner git ok: inspect_probe_attempt reads a ${STEWARD_USER}-owned repo; no global git config"
