#!/usr/bin/env python3
"""Bounded three-arm smoke launcher. No formal-run matrix entrypoint."""
import argparse,concurrent.futures,hashlib,json,os,shutil,signal,subprocess,time
from pathlib import Path
from runtime import command,git,dump,snapshot,measurements,oracle,score,audit_atm
KIT=Path(__file__).resolve().parents[1]
RESOLVER='Resolve the recorded merge conflicts in this integration worktree, preserve both submitted issue intents where possible, and run the supplied acceptance tests. Do not read gold patches or change task scope. Report unresolved conflicts explicitly.'

def checked(args,cwd=None,**kw):
 p=command(args,cwd,**kw)
 if p.returncode:raise RuntimeError('kit-error: '+p.stderr[-3000:])
 return p.stdout

def profile(config,work,session,auth,python,arm,gitdir=None,socket=None):
 """Outer Landlock policy survives inner --ignore-user-config."""
 rules={str(work):'read' if arm=='B' else 'write',str(session):'write',str(auth):'write'}
 # Explicit allowlist only: task code, dependencies, runtime, public writer client.
 for p in [Path(python).parent.parent,Path(python).resolve().parents[1],Path(shutil.which('node')).resolve().parent.parent,Path(shutil.which('codex')).resolve().parents[5]]:rules[str(p)]='read'
 for name in ['atm-write','atm-write.mjs','unified-patch.generated.mjs','live-write-journal.generated.mjs','git-shim','git-forward']:rules[str(KIT/'bin'/name)]='read'
 for name in ['stdout.jsonl','stderr.txt','session.json']:rules[str(session/name)]='deny'
 if arm!='B':
  rules[str(gitdir or work/'.git')]='write'
  rules[str(work/'.git')]='write'
  rules[git(work,'rev-parse','--absolute-git-dir')]='write'
 else:
  for name in ['.agents','.codex','.aws']:rules[str(work/name)]='write'
 if socket:rules[str(Path(socket).parent)]='read'
 text='[permissions.task]\nextends = ":workspace"\n[permissions.task.filesystem]\n'+''.join(json.dumps(p)+' = '+json.dumps(mode)+'\n' for p,mode in rules.items())+'[permissions.task.network]\nenabled = true\n'
 config.mkdir();(config/'config.toml').write_text(text);return rules

def filesystem_boundary(session,auth,work,python,policy,arm,gitdir=None,socket=None):
 """Mount only public task/runtime inputs; hide all other clone and operator-home data."""
 args=['bwrap','--unshare-user','--unshare-pid','--die-with-parent','--ro-bind','/','/','--tmpfs','/workspace','--tmpfs','/home/box']
 roots={str(Path(shutil.which('node')).resolve().parent.parent),str(Path(shutil.which('codex')).resolve().parents[5]),str(Path(python).resolve().parents[1]),str(Path(python).parent.parent),str(policy)}
 for p in sorted(roots):args+=['--ro-bind',p,p]
 for name in ['atm-write','atm-write.mjs','unified-patch.generated.mjs','live-write-journal.generated.mjs','git-shim','git-forward']:
  p=str(KIT/'bin'/name);args+=['--ro-bind',p,p]
 args+=['--ro-bind' if arm=='B' else '--bind',str(work),str(work)]
 for p in [session,auth]:args+=['--bind',str(p),str(p)]
 if arm=='B':
  for p in [work/n for n in ['.agents','.codex','.aws']]:args+=['--bind',str(p),str(p)]
 if gitdir:args+=['--bind',str(gitdir),str(gitdir)]
 if socket:args+=['--ro-bind',str(Path(socket).parent),str(Path(socket).parent)]
 return args+['--proc','/proc','--dev','/dev','--cap-drop','ALL','--']

def session(arm,slot,task,work,dest,python,privategit=None,socket=None,base=None,resolver=False,prompt_override=None):
 dest.mkdir();(dest/'home').mkdir();(dest/'tmp').mkdir()
 # Credential copy stays in scratch only and is excluded from all evidence packaging.
 auth=dest.parent/('auth-'+dest.name);auth.mkdir(mode=0o700)
 shutil.copyfile(Path.home()/'.codex/auth.json',auth/'auth.json');os.chmod(auth/'auth.json',0o600)
 outer=dest.parent/('policy-'+dest.name)
 rules=profile(outer,work,dest,auth,python,arm,privategit,socket)
 writer=str(KIT/'bin/atm-write')
 text='You are working in this local git checkout. Solve only the issue below.\nDo not mention any other task, session, or agent.\n\n'+task['problem_statement']+'\n\n'
 if arm=='B':text+=f'Every file write and commit must go through: {writer} <relative-file> <unified-diff-file>. This uses public ATM CLI 0.1.22. Exit 3 is rejected-by-design; re-read currentFileText, recompose, and retry at most 3 times. Do not directly write repository files. Report BLOCKED if unfinished. A kit crash is not a rejection.\n'
 else:text+='Edit repository files directly and commit your own fix with git.\n'
 text+='Run relevant public tests using the supplied python. After deciding the edit, emit your intended unified diff between BEGIN_INTENDED_PATCH and END_INTENDED_PATCH.\n'
 if prompt_override:text=prompt_override
 (dest/'prompt.txt').write_text(text)
 pybin=str(Path(python).parent);nodebin=str(Path(shutil.which('node')).parent)
 env={'PATH':f'{pybin}:{nodebin}:/usr/bin:/bin','HOME':str(dest/'home'),'TMPDIR':str(dest/'tmp'),'CODEX_HOME':str(auth),'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','PYTHONPATH':str(work),'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'safe.directory','GIT_CONFIG_VALUE_0':'*','GIT_AUTHOR_NAME':'prereg-session','GIT_AUTHOR_EMAIL':'session@localhost','GIT_COMMITTER_NAME':'prereg-session','GIT_COMMITTER_EMAIL':'session@localhost','PREREG_WORK':str(work),'PREREG_SESSION_DIR':str(dest),'PREREG_INSTANCE_ID':task['instance_id'],'PREREG_SESSION_SLOT':str(slot),'PREREG_SESSION_BASE_COMMIT':base or git(work,'rev-parse','HEAD'),'PREREG_ARM':arm,'PREREG_REAL_GIT':'/usr/bin/git'}
 if socket:env['PREREG_STEWARD_SOCK']=socket
 # Restore PATH/PYTHONPATH after the login shell reads /etc/profile.
 shell='export PATH='+__import__('shlex').quote(env['PATH'])+'\nexport PYTHONPATH='+__import__('shlex').quote(str(work))+'\n'
 for name in ['.bash_profile','.bashrc','.profile']:(dest/'home'/name).write_text(shell)
 inner=[shutil.which('codex'),'exec','--json','--skip-git-repo-check','--ignore-user-config','--ignore-rules','-c','approval_policy="never"','--sandbox','workspace-write','-c','sandbox_workspace_write.network_access='+('true' if arm=='B' else 'false'),'--cd',str(work),'--model','gpt-6-luna','-c','model_reasoning_effort="medium"']
 if arm!='B':inner+=['-c','sandbox_workspace_write.writable_roots='+json.dumps([str(privategit or work/'.git'),str(work/'.git'),git(work,'rev-parse','--absolute-git-dir')])]
 argv=[shutil.which('codex'),'sandbox','-P','task','-C',str(work),'--','env','-i',*[k+'='+v for k,v in env.items()],*inner,'-']
 outerenv={'PATH':os.environ['PATH'],'HOME':str(dest/'home'),'LANG':'C.UTF-8','CODEX_HOME':str(outer),'TMPDIR':str(dest/'tmp')}
 argv=[*filesystem_boundary(dest,auth,work,python,outer,arm,privategit,socket),*argv]
 if arm=='B':
  checked(['sudo','-n','chown','-R','prereg-session',dest,auth]);checked(['sudo','-n','chmod','1777',dest]);checked(['chmod','755',outer]);checked(['chmod','644',outer/'config.toml'])
  argv=['sudo','-n','-u','prereg-session','--','env','CODEX_HOME='+str(outer),'TMPDIR='+str(dest/'tmp'),*argv]
 dump(dest/'launch.json',{'argv':argv,'profile':rules,'model':'gpt-6-luna','effort':'medium','wallCapSeconds':1200,'seed':None,'resolver':resolver})
 start=time.monotonic();timed=False
 with (dest/'stdout.jsonl').open('w') as stdout,(dest/'stderr.txt').open('w') as stderr,(dest/'prompt.txt').open() as stdin:
  p=subprocess.Popen(argv,cwd=work,env=outerenv,stdin=stdin,stdout=stdout,stderr=stderr,start_new_session=True)
  try:rc=p.wait(timeout=1200)
  except subprocess.TimeoutExpired:
   timed=True;os.killpg(p.pid,signal.SIGTERM)
   try:rc=p.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);rc=p.wait()
 elapsed=time.monotonic()-start
 log=(dest/'stdout.jsonl').read_text(errors='replace')+(dest/'stderr.txt').read_text(errors='replace')
 quota=bool(__import__('re').search(r'usage limit|insufficient_quota|quota exceeded|HTTP 429',log,__import__('re').I))
 # Keep auth copy until the whole scratch directory is archived by an allowlist; never archive credentials.
 obs={'instanceId':task['instance_id'],'slot':slot,'wallSeconds':elapsed,'exitCode':rc,'capReached':timed,'quotaStop':quota,'measurements':measurements(dest/'stdout.jsonl')}
 snapdest=dest/'end-snapshot'
 if arm=='B':
  store=dest.parent/('snapshot-'+dest.name);store.mkdir();checked(['sudo','-n','chown','prereg-steward',store]);snapdest=store/'capture'
  helper=['sudo','-n','-u','prereg-steward','--',shutil.which('python3'),str(KIT/'bin/snapshot.py'),str(work),str(snapdest),base or git(work,'rev-parse','HEAD')]
  checked(helper);snap=json.loads((snapdest/'snapshot.json').read_text());obs['snapshotPath']=str(snapdest)
 else:snap=snapshot(work,snapdest,base);obs['snapshotPath']=str(snapdest)
 obs['endSnapshot']=snap;dump(dest/'session.json',obs);return obs

def public_command(g,python):
 if g['tasks'][0]['repo']=='django/django':return [python,'tests/runtests.py','--settings=test_sqlite','--parallel','1',*g['publicTests']]
 return [python,'-m','pytest','-v',*g['publicTests']]

def integrate(a,g,root,work,works,privates,arm,resolve=session):
 arm['merges']=[]
 for i in range(2):
  merge_start=time.monotonic()
  branch=git(works[i],'rev-parse','HEAD');dump(root/f'branch-{i+1}.json',{'slot':i+1,'head':branch,'base':g['commonBase'],'log':git(works[i],'log','--format=fuller',g['commonBase']+'..'+branch),'diff':git(works[i],'diff','--binary',g['commonBase'],branch)})
  checked(['git','-C',work,'fetch','--quiet',str(privates[i].parent),branch])
  q=command(['git','-C',work,'-c','user.name=integrator','-c','user.email=integrator@localhost','merge','--no-edit',branch]);conflicts=git(work,'diff','--name-only','--diff-filter=U').splitlines();receipt={'slot':i+1,'commit':branch,'initialExitCode':q.returncode,'conflictingPaths':conflicts,'resolved':not conflicts}
  if q.returncode and not conflicts:raise RuntimeError('kit-error: merge failed without conflicts: '+q.stderr)
  for round in range(1,3) if conflicts else []:
   prompt=RESOLVER+'\n\nIssues:\n'+'\n\n'.join(t['problem_statement'] for t in g['tasks'])+'\nConflicting paths: '+', '.join(conflicts)+'\nPublic test command: '+__import__('shlex').join(list(map(str,public_command(g,a.python))))+'\n'
   s=resolve('B-wt',round,g['tasks'][i],work,root/f'resolver-{i+1}-{round}',a.python,work/'.git',base=git(work,'rev-parse','HEAD'),resolver=True,prompt_override=prompt);arm['resolvers'].append(s)
   conflicts=git(work,'diff','--name-only','--diff-filter=U').splitlines()
   if not conflicts:
    public=command(public_command(g,a.python),work,env={**os.environ,'PYTHONPATH':str(work),'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1'},timeout=300)
    (root/f'resolver-public-{i+1}-{round}.log').write_text(public.stdout+public.stderr);s['publicTestExitCode']=public.returncode
    if public.returncode:continue
    if (work/'.git/MERGE_HEAD').exists():git(work,'-c','user.name=integrator','-c','user.email=integrator@localhost','commit','--no-edit')
    receipt['resolved']=True;break
  receipt['wallSeconds']=time.monotonic()-merge_start
  receipt['snapshot']=snapshot(work,root/f'integration-snapshot-{i+1}',g['commonBase'])
  arm['merges'].append(receipt)
  if not receipt['resolved']:arm['unresolved']=True;break


def main():
 ap=argparse.ArgumentParser();ap.add_argument('--dataset',type=Path,required=True);ap.add_argument('--group',required=True);ap.add_argument('--mirror',type=Path,required=True);ap.add_argument('--python',required=True);ap.add_argument('--scratch',type=Path,required=True);ap.add_argument('--arm',choices=['A','B','B-wt'],required=True);a=ap.parse_args()
 assert checked([shutil.which('codex'),'--version']).strip()=='codex-cli 0.163.0','Codex version pin mismatch'
 a.dataset=a.dataset.resolve();a.mirror=a.mirror.resolve()
 a.scratch=a.scratch.resolve();a.scratch.mkdir(exist_ok=False);root=a.scratch;arm_start=time.monotonic()
 inv=json.loads((a.dataset/'inventory.json').read_text());g=next(g for g in inv['groups'] if g['groupId']==a.group);assert g['split']=='main','held-out model sessions are forbidden in smoke'
 paths={p for t in g['tasks'] for p in __import__('re').findall(r'^diff --git a/(\S+) b/',(a.dataset/t['testPatch']).read_text(),__import__('re').M)}
 g['publicTests']=sorted({p[len('tests/'):-3].replace('/','.') for p in paths if p.startswith('tests/') and p.endswith('.py')}) if g['tasks'][0]['repo']=='django/django' else sorted(paths)
 env=os.environ;env['TMPDIR']=str(root);template=root/'template'
 checked(['git','init','--quiet',template]);checked(['git','-C',template,'fetch','--quiet','--depth=1',a.mirror,g['commonBase']]);git(template,'checkout','--quiet','--detach','FETCH_HEAD')
 work=root/'work';checked(['git','clone','--quiet',template,work]);git(work,'checkout','--quiet','--detach',g['commonBase'])
 daemon=None;sock=None;arm={'arm':a.arm,'groupId':a.group,'kitErrors':[],'sessions':[],'resolvers':[]}
 try:
  works=[work,work];privates=[None,None]
  if a.arm=='B-wt':
   for i in range(2):
    private=root/f'private-{i+1}';checked(['git','clone','--quiet',template,private]);w=root/f'work-{i+1}';git(private,'worktree','add','--quiet','-b',f'session-{i+1}',str(w),g['commonBase']);works[i]=w;privates[i]=private/'.git'
  if a.arm=='B':
   cli=Path(os.environ['PREREG_ATM_CLI']).resolve();identity=json.loads(checked(['node',cli,'--version']));assert identity['evidence']['runtimeBuildIdentity']['version']=='0.1.22'
   (work/'.prereg-smoke').mkdir();dump(work/'.prereg-smoke/session-write.json',{'writableRoot':str(work),'cli':str(cli),'cliVersion':'0.1.22','safePath':str(Path(shutil.which('node')).parent)+':/usr/bin:/bin','composeWindowMs':4000,'boundary':'unix-user'})
   checked(['sudo','-n','chown','-R','prereg-steward',work]);checked(['sudo','-n','chmod','-R','go-w',work])
   for name in ['.agents','.codex','.aws']:
    checked(['sudo','-n','mkdir','-p',work/name]);checked(['sudo','-n','chown','prereg-session',work/name]);checked(['sudo','-n','chmod','700',work/name])
   sockets=root/'sock';sockets.mkdir();checked(['sudo','-n','chown','prereg-steward',sockets]);sock=str(sockets/'s.sock')
   log=(root/'steward.log').open('w');daemon=subprocess.Popen(['sudo','-n','-u','prereg-steward','--',shutil.which('node'),str(KIT/'bin/steward-daemon.mjs'),'--sock',sock,'--cwd',str(work),'--script',str(KIT/'bin/atm-write.mjs')],stdout=log,stderr=log)
   for _ in range(100):
    if Path(sock).exists():break
    if daemon.poll() is not None:raise RuntimeError('kit-error: steward startup')
    time.sleep(.1)
   else:raise RuntimeError('kit-error: steward socket timeout')
  begin=time.monotonic()
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   fs=[pool.submit(session,a.arm,i+1,t,works[i],root/f'session-{i+1}',a.python,privates[i],sock,g['commonBase']) for i,t in enumerate(g['tasks'])]
   for f in fs:arm['sessions'].append(f.result())
  arm['taskPhaseWallSeconds']=time.monotonic()-begin
  if any(s['quotaStop'] for s in arm['sessions']):arm['quotaStop']=True
  if a.arm=='B-wt':
   for i,s in enumerate(arm['sessions']):
    submitted=root/f'submitted-{i+1}';checked(['git','clone','--quiet',privates[i].parent,submitted]);git(submitted,'checkout','--quiet','--detach',git(works[i],'rev-parse','HEAD'))
    s['submittedSnapshot']=snapshot(submitted,root/f'submitted-snapshot-{i+1}',g['commonBase'])
   integrate(a,g,root,work,works,privates,arm)
  if a.arm=='B':checked(['sudo','-n','chown','-R',str(os.getuid())+':'+str(os.getgid()),work])
  arm['finalSnapshot']=snapshot(work,root/'final-snapshot',g['commonBase'])
  oracle_start=time.monotonic()
  for s in arm['sessions']:
   if a.arm=='B-wt':
    sp=root/('submitted-snapshot-'+str(s['slot']));s['submittedOracle']=oracle(sp/'source.bundle',s['submittedSnapshot']['commit'],g,a.dataset,a.python,root/('oracle-submitted-'+str(s['slot'])))
   sp=Path(s['snapshotPath']);s['endOracle']=oracle(sp/'source.bundle',s['endSnapshot']['commit'],g,a.dataset,a.python,root/('oracle-end-'+str(s['slot'])))
  arm['finalOracle']=oracle(root/'final-snapshot/source.bundle',arm['finalSnapshot']['commit'],g,a.dataset,a.python,root/'oracle-final')
  arm['oraclePhaseWallSeconds']=time.monotonic()-oracle_start
 except Exception as error:arm['kitErrors'].append(str(error))
 finally:
  if daemon:
   daemon.terminate()
   try:daemon.wait(timeout=10)
   except subprocess.TimeoutExpired:daemon.kill();daemon.wait()
 arm['notifications']=[str(p.relative_to(root)) for p in root.glob('session-*/stdout.jsonl') if __import__('re').search(r'CONFLICT|rejected-by-design|cross-session-overlap|BLOCKED|unresolved',p.read_text(errors='replace'))]
 if any(m['conflictingPaths'] for m in arm.get('merges',[])):arm['notifications'].append('integration-conflict')
 if a.arm=='B':
  arm['receiptAudit']=audit_atm(work);arm['kitErrors']+=arm['receiptAudit']['kitErrors']
 arm['score']=score(arm)
 if a.arm=='B' and arm['score']['validity']=='VALID':
  slots={str(r['sessionSlot']) for r in arm['receiptAudit']['receipts'] if r['verified']}
  arm['acceptedWriteLossCount']=sum(loss['lost'] and str(session['slot']) in slots for loss,session in zip(arm['score']['losses'],arm['sessions']));arm['score']=score(arm)
 arm['totalWallSeconds']=time.monotonic()-arm_start;arm['manualResolutionSeconds']=None
 dump(root/'result.json',arm);print(json.dumps(arm['score']))
 return 0 if arm['score']['validity']=='VALID' else 1
if __name__=='__main__':raise SystemExit(main())
