#!/usr/bin/env python3
import importlib.util,json,os,subprocess,sys,tempfile
from pathlib import Path
K=Path(__file__).resolve().parents[1];sys.path.insert(0,str(K/'bin'))
from runtime import snapshot,git,measurements,parse_django,score
R=K.parents[3];root=Path(tempfile.mkdtemp(prefix='v14-runtime-',dir=os.environ['TMPDIR']))
w=root/'work';w.mkdir();subprocess.run(['git','init','-q',w],check=True)
(w/'a').write_text('original\n');git(w,'add','a');git(w,'-c','user.name=test','-c','user.email=test@localhost','commit','-qm','base')
head=git(w,'rev-parse','HEAD');index=(w/'.git/index').read_bytes();(w/'a').write_text('uncommitted\n');(w/'new').write_text('new file\n')
s=snapshot(w,root/'snap');assert git(w,'rev-parse','HEAD')==head;assert (w/'.git/index').read_bytes()==index
assert git(w,'show',s['commit']+':a')=='uncommitted';assert git(w,'show',s['commit']+':new')=='new file'
assert 'a' in s['manifest'] and 'new' in s['manifest']
p=root/'events.jsonl';p.write_text('\n'.join(json.dumps(x) for x in [{'type':'item.started','item':{'type':'command_execution','id':'x'}},{'type':'item.completed','item':{'type':'command_execution','id':'x'}},{'type':'turn.completed','usage':{'input_tokens':10,'output_tokens':2}}]))
m=measurements(p);assert m['toolCalls']==1;assert m['tokens'].get('total_tokens') is None;assert measurements(root/'absent')['toolCalls'] is None
labels=['test_a (mod.Class.test_a)','test_b (mod.Class.test_b)'];text='test_a (mod.Class.test_a) ... test_b (mod.Class.test_b) ... ok\nFAIL: test_a (mod.Class.test_a) (value=2)\n';assert parse_django(text,labels)=={labels[0]:'fail',labels[1]:'pass'}
def o(i,v):return {'instanceId':i,'success':v,'sourceTree':s['tree']}
sessions=[{'instanceId':'s1','exitCode':0,'wallSeconds':1,'measurements':m,'endSnapshot':s,'endOracle':[o('s1',True)]},{'instanceId':'s2','exitCode':0,'wallSeconds':1,'measurements':m,'endSnapshot':s,'endOracle':[o('s2',False)]}]
a={'sessions':sessions,'finalSnapshot':s,'finalOracle':[o('s1',False),o('s2',False)],'acceptedWriteLossCount':None}
r=score(a);assert r['validity']=='VALID' and r['lostCount']==1 and r['acceptedWriteLossCount'] is None
# Blocked/unsubmitted task does not become an accepted lost edit.
assert r['losses'][1]['lost'] is False
assert score({**a,'kitErrors':['writer kit-error']})['validity']=='INVALID'
assert score({**a,'finalOracle':[o('s1',None),o('s2',False)]})['validity']=='INVALID'
print('PASS: uncommitted snapshots, unchanged worker index/head, token nulls, unique tools, subTest parsing, loss vs unsubmitted, fail-closed invalidity')
from launch import integrate
from types import SimpleNamespace

def integration_fixture(label,resolve):
 d=root/label;d.mkdir();base=d/'base';base.mkdir();subprocess.run(['git','init','-q',base],check=True)
 (base/'guard').write_text('base\n');(base/'tests').mkdir();(base/'tests/runtests.py').write_text('raise SystemExit(0)\n');git(base,'add','.');git(base,'-c','user.name=test','-c','user.email=test@localhost','commit','-qm','base');sha=git(base,'rev-parse','HEAD')
 branches=[];privates=[]
 for i in range(2):
  private=d/f'p{i}';subprocess.run(['git','clone','-q',base,private],check=True);w=d/f'w{i}';git(private,'worktree','add','-q','-b',f's{i}',str(w));(w/'guard').write_text(f'slot{i+1}\n');git(w,'add','guard');git(w,'-c','user.name=test','-c','user.email=test@localhost','commit','-qm',f'slot{i+1}');branches.append(w);privates.append(private/'.git')
 work=d/'integration';subprocess.run(['git','clone','-q',base,work],check=True)
 arm={'resolvers':[]};group={'commonBase':sha,'publicTests':['migrations.test_loader'],'tasks':[{'repo':'django/django','instance_id':f't{i}','problem_statement':f'preserve slot{i+1}'} for i in range(2)]}
 integrate(SimpleNamespace(python=sys.executable),group,d,work,branches,privates,arm,resolve=resolve)
 assert [x['slot'] for x in arm['merges']]==[1,2]
 assert not arm['merges'][0]['conflictingPaths'] and arm['merges'][1]['conflictingPaths']==['guard']
 return arm,work

def resolves(arm,slot,task,work,dest,python,*args,**kw):
 assert kw['resolver'] is True and 'preserve both submitted issue intents' in kw['prompt_override'];(work/'guard').write_text('slot1+slot2\n');git(work,'add','guard');return {'modelCalls':0,'fixture':True}
a,w=integration_fixture('resolved',resolves);assert len(a['resolvers'])==1 and a['merges'][1]['resolved'];assert (w/'guard').read_text()=='slot1+slot2\n'
def unresolved(*args,**kw):return {'modelCalls':0,'fixture':True}
a,w=integration_fixture('unresolved',unresolved);assert len(a['resolvers'])==2 and a['unresolved'] is True
print('PASS: actual launcher fixed-order integration, native conflict paths, one-round resolution and R_max=2 exhaustion; modelCalls=0')

# A successful uncommitted edit is reported separately from submitted-branch loss.
sessions[0]['submittedSnapshot']=s;sessions[1]['submittedSnapshot']=s
sessions[0]['submittedOracle']=[o('s1',False)];sessions[1]['submittedOracle']=[o('s2',False)]
r=score({'arm':'B-wt','sessions':sessions,'finalSnapshot':s,'finalOracle':[o('s1',False),o('s2',False)],'notifications':[]})
assert r['validity']=='VALID' and r['lostCount']==0 and r['losses'][0]['unsubmittedSuccessfulEnd'] is True
print('PASS: successful uncommitted B-wt work is separate from submitted losses')
