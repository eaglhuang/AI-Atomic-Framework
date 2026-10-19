#!/bin/bash
# 公開 CLI 對沒有改到檔案的 patch 仍回 accepted。atm-write 必須改記 kit-error。
# 真的改到檔案並留下 proposal commit 的寫入仍是 accepted。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(mktemp -d)"
cleanup() { rm -rf "$BASE"; }
trap cleanup EXIT

cat > "$BASE/fake-cli.mjs" <<'EOF'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

if (process.argv.includes('--version')) {
  process.stdout.write(`${JSON.stringify({ evidence: { frameworkVersion: '0.1.21' } })}\n`);
  process.exit(0);
}
const index = process.argv.indexOf('--proposal-file');
const proposal = JSON.parse(readFileSync(path.resolve(process.argv[index + 1]), 'utf8'));
const target = path.resolve(proposal.targetFile);
const before = readFileSync(target);
if (process.env.FAKE_CLI_MODE === 'apply') {
  writeFileSync(target, 'changed\n');
  const git = (args) => spawnSync('/usr/bin/git', args, { cwd: process.cwd(), encoding: 'utf8' });
  const add = git(['add', '--', proposal.targetFile]);
  if (add.status !== 0) process.exit(1);
  const commit = git([
    '-c', 'user.name=atm-steward',
    '-c', 'user.email=atm-steward@localhost',
    'commit', '-m', `steward live write ${proposal.proposalId}`,
    '--', proposal.targetFile
  ]);
  if (commit.status !== 0) process.exit(1);
}
const after = readFileSync(target);
const hash = `sha256:${createHash('sha256').update(after).digest('hex')}`;
const head = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();
const body = {
  ok: true,
  messages: [{ code: 'ATM_BROKER_LIVE_WRITE_APPLIED', text: 'applied' }],
  evidence: {
    liveWrites: [{
      decision: 'accepted',
      verdict: 'applied',
      currentFileText: after.toString('utf8'),
      currentFileHash: hash,
      commitSha: head,
      detail: before.equals(after) ? 'patch 沒有改變檔案' : '已寫入並提交'
    }]
  }
};
process.stdout.write(`${JSON.stringify(body)}\n`);
EOF

prepare_repo() {
  local repo="$1"
  mkdir -p "$repo/.prereg-smoke"
  git -C "$repo" init -q
  printf 'alpha\nbeta\n' > "$repo/note.txt"
  git -C "$repo" add note.txt
  git -C "$repo" -c user.name=prereg -c user.email=prereg@localhost commit -q -m base
  python3 - "$repo" "$BASE/fake-cli.mjs" <<'PY'
import json, pathlib, sys
repo, cli = sys.argv[1:]
payload = {
    "writableRoot": repo,
    "cli": cli,
    "cliVersion": "0.1.21",
    "safePath": "/usr/bin:/bin",
}
path = pathlib.Path(repo) / ".prereg-smoke" / "session-write.json"
path.write_text(json.dumps(payload) + "\n")
PY
}

# A well-formed, context-only hunk: it parses, so atm-write hands it to the CLI,
# but it changes nothing. Malformed patches no longer reach the CLI (#361); see
# test-atm-write-malformed.sh.
cat > "$BASE/noop.diff" <<'EOF'
--- a/note.txt
+++ b/note.txt
@@ -1,2 +1,2 @@
 alpha
 beta
EOF

prepare_repo "$BASE/noop"
before="$(git -C "$BASE/noop" rev-parse HEAD)"
set +e
FAKE_CLI_MODE=noop node "$HERE/bin/atm-write.mjs" note.txt "$BASE/noop.diff" --cwd "$BASE/noop" >"$BASE/noop.json"
noop_status=$?
set -e
python3 - "$BASE/noop.json" "$noop_status" "$BASE/noop/note.txt" "$before" "$BASE/noop" <<'PY'
import json, pathlib, subprocess, sys
row = json.loads(pathlib.Path(sys.argv[1]).read_text())
status = int(sys.argv[2])
text = pathlib.Path(sys.argv[3]).read_text()
before = sys.argv[4]
repo = sys.argv[5]
assert status == 1, (status, row)
assert row["decision"] == "kit-error", row
assert row["reasonCode"] == "write-not-applied", row
assert row["messageCode"] is None, row
assert row["ok"] is False, row
assert text == "alpha\nbeta\n", text
head = subprocess.check_output(["git", "-C", repo, "rev-parse", "HEAD"], text=True).strip()
assert head == before, (before, head)
print("noop downgraded")
PY

prepare_repo "$BASE/apply"
set +e
FAKE_CLI_MODE=apply node "$HERE/bin/atm-write.mjs" note.txt "$BASE/noop.diff" --cwd "$BASE/apply" >"$BASE/apply.json"
apply_status=$?
set -e
python3 - "$BASE/apply.json" "$apply_status" "$BASE/apply" <<'PY'
import json, pathlib, subprocess, sys
row = json.loads(pathlib.Path(sys.argv[1]).read_text())
status = int(sys.argv[2])
repo = sys.argv[3]
assert status == 0, (status, row)
assert row["decision"] == "accepted", row
text = pathlib.Path(repo, "note.txt").read_text()
assert text == "changed\n", text
subject = subprocess.check_output(["git", "-C", repo, "log", "-1", "--format=%s"], text=True)
assert row["proposalId"] in subject, subject
print("apply kept")
PY
echo "false accept guard ok"
