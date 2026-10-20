#!/bin/bash
# Exercise direct and socket writers against an offline rejected-write CLI.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$HERE" <<'PY'
import hashlib, json, os, pathlib, subprocess, sys, tempfile, time
kit = pathlib.Path(sys.argv[1])
with tempfile.TemporaryDirectory() as tmp:
    root=pathlib.Path(tmp); repo=root/'repo'; repo.mkdir(); (repo/'.prereg-smoke').mkdir()
    subprocess.run(['git','init','-q',str(repo)],check=True)
    (repo/'note.txt').write_text('old\n')
    subprocess.run(['git','-C',str(repo),'add','note.txt'],check=True)
    subprocess.run(['git','-C',str(repo),'-c','user.name=test','-c','user.email=test@localhost','commit','-qm','base'],check=True)
    patch=root/'change.patch'; patch.write_text('--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
    cli=root/'fake-cli.mjs';cli.write_text('''import {readFileSync} from 'node:fs';
if(process.argv.includes('--version')) { console.log(JSON.stringify({evidence:{frameworkVersion:'0.1.21'}})); }
else {let p=JSON.parse(readFileSync(process.argv[process.argv.indexOf('--proposal-file')+1]));console.log(JSON.stringify({ok:false,messages:[{code:'ATM_BROKER_LIVE_WRITE_BLOCKED'}],evidence:{liveWrites:[{decision:'rejected-by-design',verdict:'blocked',reasonCode:'patch-context-mismatch',currentFileHash:p.fileBeforeHash}]}}));}
''')
    (repo/'.prereg-smoke/session-write.json').write_text(json.dumps({'writableRoot':str(repo),'cli':str(cli),'safePath':'/usr/bin:/bin'}))
    base=os.environ.copy();base.pop('PREREG_STEWARD_SOCK',None);base.pop('PREREG_SESSION_SLOT',None)
    def write(slot, socket=None):
        env={**base,'PREREG_SESSION_SLOT':slot,'PREREG_SESSION_BASE_COMMIT':subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()}
        if socket:env['PREREG_STEWARD_SOCK']=str(socket)
        r=subprocess.run(['node',str(kit/'bin/atm-write.mjs'),'note.txt',str(patch),'--cwd',str(repo),'--actor','same'],env=env,text=True,capture_output=True)
        assert r.returncode==3,(r.returncode,r.stdout,r.stderr)
        row=json.loads(r.stdout);assert row['sessionSlot']==slot,row
        assert row['actorId']=='same-slot-'+slot,row
        assert 'slot-'+slot in row['proposalId'],row
        assert row['reasonCode']=='patch-context-mismatch',row
        assert row['declaredBaseHash']=='sha256:'+hashlib.sha256(b'old\n').hexdigest(),row
        return row
    one=write('1');two=write('2');assert one['proposalId']!=two['proposalId']
    sock=root/'steward.sock'
    daemon=subprocess.Popen(['node',str(kit/'bin/steward-daemon.mjs'),'--sock',str(sock),'--cwd',str(repo),'--script',str(kit/'bin/atm-write.mjs')],env={**base,'PREREG_SESSION_SLOT':'wrong-daemon-slot','PREREG_SESSION_BASE_COMMIT':'wrong-daemon-base'},stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            if sock.exists():break
            assert daemon.poll() is None
            time.sleep(.02)
        assert sock.exists()
        socket_one=write('1',sock);socket_two=write('2',sock)
        assert socket_one['proposalId']==one['proposalId']
        assert socket_two['proposalId']==two['proposalId']
        write('3',sock)  # No prior reply: this slot needs the forwarded start commit.
    finally:
        daemon.terminate();daemon.communicate(timeout=5)
    rows=[json.loads(line) for line in (repo/'.prereg-smoke/steward-writes.jsonl').read_text().splitlines()]
    assert [r['sessionSlot'] for r in rows]==['1','2','1','2','3'],rows
print('direct/socket session slot attribution passed')
PY
