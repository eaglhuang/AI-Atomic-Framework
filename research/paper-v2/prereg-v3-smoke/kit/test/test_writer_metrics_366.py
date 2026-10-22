#!/usr/bin/env python3
"""Real invocation retry derivation, flag distrust, nulls and socket model failures."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time

KIT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    subprocess.run(['/usr/bin/git', 'init', '-q', str(root)], check=True)
    (root / 'note.txt').write_text('one\ntwo\nthree\n')
    subprocess.run(['/usr/bin/git', '-C', str(root), 'add', 'note.txt'], check=True)
    subprocess.run(['/usr/bin/git', '-C', str(root), '-c', 'user.name=test', '-c', 'user.email=test@localhost',
                    'commit', '-qm', 'base'], check=True)
    base = subprocess.check_output(['/usr/bin/git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    cli = root / 'fake-cli.mjs'
    cli.write_text("if(process.argv.includes('--version')) console.log(JSON.stringify({evidence:{frameworkVersion:'0.1.21'}})); "
                   "else console.log(JSON.stringify({evidence:{liveWrites:[{decision:'rejected-by-design',reasonCode:'cross-session-overlap'}]}}));")
    smoke = root / '.prereg-smoke'
    smoke.mkdir()
    config = smoke / 'session-write.json'
    config.write_text(json.dumps({'writableRoot': str(root), 'cli': str(cli), 'safePath': '/usr/bin:/bin'}))
    env = {**os.environ, 'PREREG_SESSION_BASE_COMMIT': base, 'PREREG_SESSION_SLOT': 'one'}
    env.pop('PREREG_STEWARD_SOCK', None)
    patch = root / 'change.patch'
    def submit(text, actor='model', flags=(), child_env=env):
        patch.write_text(text)
        # Exactly the real process-substitution shape; bash arguments avoid interpolation.
        proc = subprocess.run(['/bin/bash', '-c', 'node "$1" note.txt <(cat "$2") --cwd "$3" --actor "$4" "${@:5}"',
                               'test', str(KIT / 'bin/atm-write.mjs'), str(patch), str(root), actor, *flags],
                              env=child_env, text=True, capture_output=True)
        return proc.returncode, json.loads(proc.stdout)
    overlap = '@@ -1 +1 @@\n-one\n+changed\n'
    for attempt in (1, 2, 3):
        code, row = submit(overlap, flags=('--attempt', '99') if attempt == 3 else ())
        assert code == 3 and row['attempt'] == attempt and row['retryCount'] == attempt - 1, row
        assert row['hashDriftCount'] is None and row['commit'] == {'gitIndexLockWaitMs': None, 'headMoves': None}, row
    assert submit('@@ -3 +3 @@\n-three\n+other\n')[1]['attempt'] == 1
    assert submit(overlap, actor='another-session')[1]['attempt'] == 1
    # Socket must pass malformed patches to the same parser instead of treating
    # missing @@ as a transport/kit failure.
    sock_path = root / 'steward.sock'
    daemon = subprocess.Popen(['node', str(KIT / 'bin/steward-daemon.mjs'), '--sock', str(sock_path),
                               '--cwd', str(root), '--script', str(KIT / 'bin/atm-write.mjs')],
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env)
    try:
        for _ in range(100):
            if sock_path.exists():
                break
            time.sleep(.02)
        for text, reason in [('prose, no diff\n', 'patch-malformed'),
                             ('@@ -1,1 +1,1@@\n-one\n+x\n', 'patch-malformed'),
                             ('@@ -1 +1 @@\n one\n', 'patch-noop'),
                             ('@@ -1 +1 @@\n-one\n+one\n', 'patch-noop')]:
            code, row = submit(text, child_env={**env, 'PREREG_STEWARD_SOCK': str(sock_path)})
            assert code == 3 and row['decision'] == 'rejected-by-design' and row['reasonCode'] == reason, row
        config.write_text(json.dumps({'writableRoot': str(root), 'cli': str(root / 'missing-cli'), 'safePath': '/usr/bin:/bin'}))
        code, row = submit(overlap)
        assert code == 1 and row['decision'] == 'kit-error' and row['reasonCode'] == 'cli-unavailable', row
    finally:
        daemon.terminate()
        daemon.communicate(timeout=5)
print('issue 366 writer real-mode attempts, isolation, nulls, malformed/no-op and infrastructure passed')
