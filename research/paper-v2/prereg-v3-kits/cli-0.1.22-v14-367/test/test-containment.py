#!/usr/bin/env python3
"""No model calls. Exercise inherited kernel boundary with native tools."""
import json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
K=Path(__file__).resolve().parents[1];sys.path.insert(0,str(K/'bin'))
from launch import profile,filesystem_boundary
from runtime import git
root=Path(tempfile.mkdtemp(prefix='v14-boundary-',dir=os.environ['TMPDIR'])).resolve()
os.chmod(root,0o755)
secret=root/'gold';secret.write_text('GOLD_SENTINEL');peer=root/'peer';peer.mkdir();(peer/'guard').write_text('peer guard')
python=os.environ['PREREG_PYTHON'];codex=shutil.which('codex')
for arm in ['A','B','B-wt']:
 d=root/arm;d.mkdir();session=d/'session';session.mkdir();(session/'tmp').mkdir();auth=d/'auth';auth.mkdir();work=d/'work';work.mkdir();(work/'guard').write_text('guard\n')
 subprocess.run(['git','init','-q',work],check=True);git(work,'add','guard');git(work,'-c','user.name=test','-c','user.email=test@localhost','commit','-qm','base')
 private=None
 if arm=='B-wt':
  private=d/'private';subprocess.run(['git','clone','-q',work,private],check=True);w=d/'wt';git(private,'worktree','add','-q','-b','session',str(w));work=w
 outer=d/'policy';rules=profile(outer,work,session,auth,python,arm,private/'.git' if private else None)
 if arm=='B':
  subprocess.run(['sudo','-n','chown','-R','prereg-steward',work],check=True);subprocess.run(['sudo','-n','chown','-R','prereg-session',session,auth],check=True)
  for name in ['.agents','.codex','.aws']:
   subprocess.run(['sudo','-n','mkdir','-p',work/name],check=True);subprocess.run(['sudo','-n','chown','prereg-session',work/name],check=True)
 probe='''set -eu
cat guard > /dev/null
if cat /home/box/.codex/auth.json > /dev/null 2>&1; then exit 30; fi
if ls /home/box/.codex/sessions > /dev/null 2>&1; then exit 38; fi
if cat "$1" > /dev/null 2>&1; then exit 31; fi
if printf bad >> "$2/guard" 2>/dev/null; then exit 32; fi
if cat "$3/research/paper-v2/prereg-v3-datasets/2026-10-24-six-pairs/inventory.json" > /dev/null 2>&1; then exit 33; fi
'''
 if arm=='B':probe+='''if printf bad >> guard 2>/dev/null; then exit 34; fi
if chmod u+w guard 2>/dev/null; then exit 35; fi
if mv guard renamed 2>/dev/null; then exit 36; fi
if rm guard 2>/dev/null; then exit 37; fi
'''
 else:probe+='''printf own >> guard
git -c safe.directory='*' add guard
git -c safe.directory='*' -c user.name=probe -c user.email=probe@localhost commit -qm probe
'''
 probe+='echo CONTAINMENT_PASS\n'
 cmd=[codex,'sandbox','-P','task','-C',str(work),'--','bash','-c',probe,'probe',str(secret),str(peer),str(K.parents[3])]
 cmd=[*filesystem_boundary(session,auth,work,python,outer,arm,private/'.git' if private else None),*cmd]
 env={**os.environ,'CODEX_HOME':str(outer),'TMPDIR':str(session/'tmp')}
 if arm=='B':cmd=['sudo','-n','-u','prereg-session','--','env','CODEX_HOME='+str(outer),'PATH='+os.environ['PATH'],'TMPDIR='+str(session/'tmp'),*cmd]
 q=subprocess.run(cmd,env=env,text=True,capture_output=True,timeout=30);(d/'probe.log').write_text(q.stdout+q.stderr)
 assert q.returncode==0,(arm,q.returncode,q.stderr);assert 'CONTAINMENT_PASS' in q.stdout
 assert (peer/'guard').read_text()=='peer guard';assert secret.read_text()=='GOLD_SENTINEL';print(arm,'PASS')
print('PASS: real kernel read denial, peer write denial, B write/chmod/move/delete denial, A/B-wt real Git commits including private metadata; modelCalls=0')
# Same B socket client and kernel boundary as production, without a model.
cli=os.environ.get('PREREG_ATM_CLI')
if cli:
 d=root/'B';work=d/'work';session=d/'session';auth=d/'auth';sockets=root/'s';sockets.mkdir();subprocess.run(['sudo','-n','chown','prereg-steward',sockets],check=True);sock=str(sockets/'s.sock')
 config=root/'writer.json';config.write_text(json.dumps({'writableRoot':str(work),'cli':cli,'cliVersion':'0.1.22','safePath':str(Path(shutil.which('node')).parent)+':/usr/bin:/bin','composeWindowMs':4000,'boundary':'unix-user'}))
 subprocess.run(['sudo','-n','mkdir',work/'.prereg-smoke'],check=True);subprocess.run(['sudo','-n','cp',config,work/'.prereg-smoke/session-write.json'],check=True);subprocess.run(['sudo','-n','chown','-R','prereg-steward',work/'.prereg-smoke'],check=True)
 log=(root/'steward.log').open('w');daemon=subprocess.Popen(['sudo','-n','-u','prereg-steward','--',shutil.which('node'),str(K/'bin/steward-daemon.mjs'),'--sock',sock,'--cwd',str(work),'--script',str(K/'bin/atm-write.mjs')],stdout=log,stderr=log)
 try:
  import time
  for _ in range(100):
   if Path(sock).exists():break
   time.sleep(.1)
  assert Path(sock).exists(),(root/'steward.log').read_text()
  policy=d/'writer-policy';profile(policy,work,session,auth,python,'B',socket=sock)
  patch=session/'patch.diff';subprocess.run(['sudo','-n','-u','prereg-session','--','tee',str(patch)],input='diff --git a/guard b/guard\n--- a/guard\n+++ b/guard\n@@ -1 +1 @@\n-guard\n+accepted through socket\n',text=True,capture_output=True,check=True)
  cmd=['sudo','-n','-u','prereg-session','--','env','CODEX_HOME='+str(policy),'TMPDIR='+str(session/'tmp'),'PATH='+os.environ['PATH'],*filesystem_boundary(session,auth,work,python,policy,'B',socket=sock),codex,'sandbox','-P','task','-C',str(work),'--','env','PREREG_WORK='+str(work),'PREREG_SESSION_DIR='+str(session),'PREREG_SESSION_SLOT=1','PREREG_SESSION_BASE_COMMIT='+git(work,'rev-parse','HEAD'),'PREREG_STEWARD_SOCK='+sock,str(K/'bin/atm-write'),'guard',str(patch)]
  q=subprocess.run(cmd,text=True,capture_output=True,timeout=60);(root/'socket-probe.log').write_text(q.stdout+q.stderr);assert q.returncode==0,(q.stdout,q.stderr);assert (work/'guard').read_text()=='accepted through socket\n'
  print('PASS: B accepted write through public CLI socket inside inherited boundary; modelCalls=0')
 finally:
  daemon.terminate()
  try:daemon.wait(timeout=10)
  except subprocess.TimeoutExpired:daemon.kill();daemon.wait()
else:
 raise RuntimeError('PREREG_ATM_CLI is mandatory for socket containment regression')
