"""#398: real CLI path, no model, no manual base/attempt override or ATM state edits."""
import hashlib,json,os,subprocess,tempfile
from pathlib import Path

REPO=Path(__file__).resolve().parents[5]
KIT=Path(__file__).resolve().parents[1]
NODE=Path('/home/box/.local/node24-latest/bin/node')
CLI=Path(os.environ.get('PREREG_ATM_CLI',str(REPO/'.worklogs/public-cli/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs')))
BASE='98ad327864aed8df245fd19ea9d2743279e11643'
FILE='django/db/migrations/loader.py'
GUARD="if getattr(module, '__file__', None) is None and not isinstance(module.__path__, list):"
assert os.environ.get('TMPDIR','').startswith(str(REPO)+'/' ), 'explicit clone-local TMPDIR required'
ROOT=Path(tempfile.mkdtemp(prefix='intent398.',dir=os.environ['TMPDIR']))
ENV={**os.environ,'GIT_AUTHOR_NAME':'intent-test','GIT_AUTHOR_EMAIL':'intent@localhost',
     'GIT_COMMITTER_NAME':'intent-test','GIT_COMMITTER_EMAIL':'intent@localhost'}
def run(args,cwd=None,env=None):
 return subprocess.run([str(a) for a in args],cwd=cwd,env=env or ENV,capture_output=True,text=True,timeout=90)
BASES={}
def fixture(name):
 work=ROOT/name
 work.mkdir()
 target=work/FILE;target.parent.mkdir(parents=True)
 target.write_bytes((KIT/'test/fixtures/398/base.py').read_bytes())
 assert run(['git','init','-q',work]).returncode==0
 assert run(['git','add',FILE],work).returncode==0
 assert run(['git','commit','-q','-m','fixture base'],work).returncode==0
 BASES[str(work)]=run(['git','rev-parse','HEAD'],work).stdout.strip()
 (work/'.prereg-smoke').mkdir()
 (work/'.prereg-smoke/session-write.json').write_text(json.dumps({'cli':str(CLI),'cliVersion':'0.1.22',
   'boundary':'unix-user','safePath':str(NODE.parent)+':/usr/bin:/bin','writableRoot':str(work)}))
 return work
def submit(work,slot,patch,ack=None,target=FILE):
 p=ROOT/(work.name+'-'+str(slot)+'-'+hashlib.sha256(patch.encode()).hexdigest()+'.patch');p.write_text(patch)
 args=[NODE,KIT/'bin/atm-write.mjs',target,p,'--cwd',work,'--task','prereg']
 if ack:args+=['--ack-overlap',ack]
 proc=run(args,work,{**ENV,'PREREG_SESSION_SLOT':str(slot),'PREREG_SESSION_BASE_COMMIT':BASES[str(work)]})
 out=json.loads(proc.stdout)
 assert out['decision']!='kit-error',out
 return out

inputs=KIT/'test/fixtures/398'
work=fixture('original-four')
outputs=[]
for i,slot in enumerate([2,1,2,2],1):
 outputs.append(submit(work,slot,(inputs/f'{i}-slot-{slot}.patch').read_text()))
assert [o['decision'] for o in outputs]==['rejected-by-design','accepted','rejected-by-design','rejected-by-design'],outputs
assert outputs[-1]['reasonCode']=='cross-session-overlap',outputs[-1]
assert GUARD in (work/FILE).read_text()
anchors=[json.loads(x) for x in (work/'.atm/runtime/live-write-anchors.jsonl').read_text().splitlines()]
anchor=next(x for x in anchors if x['actorId']=='prereg-session-slot-2')
assert anchor['baseHash'].removeprefix('sha256:')=='7dca66d253358f3dfbda3d68ceffb8b9fee4d0f47d8ddef2fa4d25e78ff1b05c'
# Explicit acknowledgement permits the same removal and is recorded, not inferred from a reply.
ack=submit(work,2,(inputs/'4-slot-2.patch').read_text(),outputs[1]['proposalId'])
assert ack['decision']=='accepted' and GUARD not in (work/FILE).read_text(),ack
assert outputs[1]['proposalId'] in ack['acknowledgedOverlap'],ack

# An initial no-op also establishes an anchor before a later peer change.
noop='@@ -1 +1 @@\n-import pkgutil\n+import pkgutil\n'
work=fixture('noop-first')
first=submit(work,2,noop)
assert first['decision']=='rejected-by-design',first
accepted=submit(work,1,(inputs/'2-slot-1.patch').read_text())
assert accepted['decision']=='accepted',accepted
last=submit(work,2,(inputs/'4-slot-2.patch').read_text())
assert last['reasonCode'] in {'cross-session-overlap','overlapping-write-queued'} and GUARD in (work/FILE).read_text(),last
if last['reasonCode']=='overlapping-write-queued':
 last=submit(work,2,(inputs/'4-slot-2.patch').read_text())
 assert last['reasonCode']=='cross-session-overlap' and GUARD in (work/FILE).read_text(),last

# A peer's disjoint edit remains allowed; same-session replacement is not cross-session overlap.
disjoint='@@ -1 +1,2 @@\n import pkgutil\n+# disjoint intent regression\n'
other=submit(work,2,disjoint)
assert other['decision']=='accepted',other
same=submit(work,1,(inputs/'4-slot-2.patch').read_text())
assert same['decision']=='accepted',same
print(json.dumps({'issue':398,'status':'passed','originalReplayFinal':'cross-session-overlap',
 'explicitAcknowledgement':'accepted','noopOriginalAnchor':'preserved','disjoint':'accepted',
 'sameSession':'accepted','modelCalls':0,'retainedScratch':str(ROOT)}))
