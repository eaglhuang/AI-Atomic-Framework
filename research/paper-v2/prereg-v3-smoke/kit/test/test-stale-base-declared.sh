#!/bin/bash
# 重複的 context 仍對得上 live 時，也只能宣告 session 真正看過的 base。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
source "$HERE/lib/common.sh"
BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
REPO="$BASE/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
printf 'a\nb\nb\nc\n' > "$REPO/note.txt"
git -C "$REPO" add note.txt
git -C "$REPO" -c user.name=prereg -c user.email=prereg@localhost commit -q -m base
export PREREG_BOUNDARY=codex-sandbox
write_session_write_config "$REPO"
python3 - "$HERE" "$REPO" "$BASE" <<'PY'
import hashlib, json, os, pathlib, subprocess, sys
kit, repo, root = map(pathlib.Path, sys.argv[1:])
base_commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
hash_of = lambda text: 'sha256:' + hashlib.sha256(text.encode()).hexdigest()
base_hash = hash_of('a\nb\nb\nc\n')
env = os.environ.copy()
for key in ('PREREG_STEWARD_SOCK', 'PREREG_SESSION_SLOT', 'PREREG_SESSION_BASE_COMMIT'):
    env.pop(key, None)

def write(slot, patch, *, commit=base_commit, base_file=None):
    patch_path = root / 'change.patch'
    patch_path.write_text(patch)
    child_env = {**env, 'PREREG_SESSION_SLOT': slot}
    if commit is not None:
        child_env['PREREG_SESSION_BASE_COMMIT'] = commit
    args = ['node', str(kit / 'bin/atm-write.mjs'), 'note.txt', str(patch_path), '--cwd', str(repo), '--actor', 'session']
    if base_file:
        args += ['--base-file', str(base_file)]
    result = subprocess.run(args, env=child_env, text=True, capture_output=True, timeout=60)
    return result.returncode, json.loads(result.stdout)

status, x = write('1', '@@ -0,0 +1 @@\n+Z\n')
assert status == 0 and x['decision'] == 'accepted', (status, x)
assert x['declaredBaseHash'] == base_hash, x
live_hash = hash_of('Z\na\nb\nb\nc\n')
assert x['currentFileHash'] == live_hash, x

status, y = write('2', '@@ -3 +3 @@\n-b\n+B3\n')
assert status in (0, 3), (status, y)
assert y['declaredBaseHash'] == base_hash != live_hash, y
final = (repo / 'note.txt').read_text()

# 沒有啟動 commit 的新 slot 不得借用其他 slot 的 base，也不得呼叫 CLI。
cli = root / 'must-not-call.mjs'
marker = root / 'cli-called'
cli.write_text("import {writeFileSync} from 'node:fs'; writeFileSync(" + json.dumps(str(marker)) + ", 'called'); process.exit(1);\n")
config = repo / '.prereg-smoke/session-write.json'
(repo / '.prereg-smoke/session-write.json.orig').write_text(config.read_text())
config.write_text(json.dumps({'writableRoot': str(repo), 'cli': str(cli), 'safePath': '/usr/bin:/bin'}))
status, unknown = write('3', '@@ -1 +1 @@\n-Z\n+ZZ\n', commit=None)
assert status == 3, (status, unknown)
assert unknown['decision'] == 'rejected-by-design' and unknown['reasonCode'] == 'base-unknown', unknown
assert unknown['declaredBaseHash'] is None and unknown['hunkOffsets'] is None, unknown
assert unknown['currentFileText'] == final, unknown
assert unknown['currentFileHash'] == hash_of(final), unknown
assert (repo / 'note.txt').read_text() == final
assert not marker.exists(), 'base-unknown called CLI (including --version)'

seen = [json.loads(line) for line in (repo / '.prereg-smoke/session-seen.jsonl').read_text().splitlines()]
for row, reply in zip(seen, (x, y, unknown)):
    assert row['actorId'] == reply['actorId'] and row['sessionSlot'] == reply['sessionSlot'], row
    assert row['file'] == 'note.txt' and row['seenHash'] == reply['currentFileHash'], row
    assert row['source'] == 'atm-write-reply' and row['at'], row
assert len(seen) == 3, seen
print('declared base, reply tracking and base-unknown ok', flush=True)
# 套件的責任是宣告 session 真正看過的 base（上面已驗）。放在哪一行由 CLI 決定：
# 公開 CLI 0.1.21 仍按宣告行號套到目前檔案（#363 C1），會落在第一個 b。
# core 已改成把過期 patch 從 base 平移到目前檔案；新版 CLI 發布前，0.1.21 的錯位只記錄、不算通過條件。
cli_version = json.loads((repo / '.prereg-smoke/session-write.json.orig').read_text()).get('cliVersion')
if cli_version == '0.1.21' and final == 'Z\na\nB3\nb\nc\n':
    print('known CLI 0.1.21 stale placement (#363 C1): fixed in core, effective after a new CLI release', flush=True)
else:
    assert final in ('Z\na\nb\nb\nc\n', 'Z\na\nb\nB3\nc\n'), final
print('stale base declaration and base-unknown ok')
PY
