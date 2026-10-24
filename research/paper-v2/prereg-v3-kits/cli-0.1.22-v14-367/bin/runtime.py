#!/usr/bin/env python3
"""New-generation evidence primitives. Missing observations remain None."""
import hashlib,json,os,re,subprocess,time,xml.etree.ElementTree as ET
from pathlib import Path

def command(args,cwd=None,env=None,timeout=180,input=None):
    return subprocess.run(list(map(str,args)),cwd=cwd,env=env,input=input,text=True,capture_output=True,timeout=timeout)

def git(work,*args,env=None):
    p=command(['git','-c','safe.directory=*','-C',work,*args],env=env)
    if p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()

def dump(path,value):
    Path(path).write_text(json.dumps(value,indent=2)+'\n')

def source_manifest(work):
    names=git(work,'ls-files','--cached','--others','--exclude-standard','-z').split('\0')
    excluded={'.atm','.prereg-smoke','.codex','.agents','.aws','__pycache__','.pytest_cache'}
    result={}
    for name in names:
        p=Path(work)/name
        if not name or excluded.intersection(Path(name).parts) or not (p.exists() or p.is_symlink()):continue
        if p.is_symlink(): data=('symlink:'+os.readlink(p)).encode()
        elif p.is_file():data=p.read_bytes()
        else:continue
        blob=os.readlink(p).encode() if p.is_symlink() else data
        result[name]={'sha256':hashlib.sha256(data).hexdigest(),'gitBlobSha1':hashlib.sha1(b'blob '+str(len(blob)).encode()+b'\0'+blob).hexdigest(),'mode':p.lstat().st_mode & 0o777}
    return result

def snapshot(work,dest,base=None):
    """Independent index captures uncommitted files; never updates worker refs/index."""
    dest=Path(dest);dest.mkdir(exist_ok=False)
    start=time.monotonic()
    for attempt in range(3):
        before=source_manifest(work)
        index=dest/f'index-{attempt}'
        env={**os.environ,'GIT_INDEX_FILE':str(index.resolve())}
        git(work,'read-tree','HEAD',env=env)
        # Start from HEAD, excluding runtime files even if an agent tracked them.
        tracked=git(work,'ls-files','-z').split('\0')
        excluded=set(tracked)-set(before)
        if excluded:
            p=command(['git','-c','safe.directory=*','-C',work,'update-index','--force-remove','-z','--stdin'],env=env,input='\0'.join(sorted(excluded))+'\0')
            if p.returncode:raise RuntimeError(p.stderr)
        if before:
            p=command(['git','-c','safe.directory=*','-C',work,'add','--pathspec-from-file=-','--pathspec-file-nul'],env=env,input='\0'.join(sorted(before))+'\0')
            if p.returncode:raise RuntimeError(p.stderr)
        tree=git(work,'write-tree',env=env)
        after=source_manifest(work)
        entries=git(work,'ls-tree','-rz',tree).split('\0')
        captured={e.split('\t',1)[1]:e.split('\t',1)[0].split()[2] for e in entries if e}
        if before==after and captured=={name:info['gitBlobSha1'] for name,info in before.items()}:
            worker_head=git(work,'rev-parse','HEAD')
            commit=git(work,'-c','user.name=snapshot','-c','user.email=snapshot@localhost','commit-tree',tree,'-m','sealed source snapshot',env=env)
            base_tree=git(work,'rev-parse',(base or worker_head)+'^{tree}')
            baseline=git(work,'-c','user.name=snapshot','-c','user.email=snapshot@localhost','commit-tree',base_tree,'-m','sealed baseline source',env=env)
            # Export self-contained Git bundle under a fresh ref; no moving worker branch.
            ref='refs/prereg-snapshots/'+hashlib.sha256(str(dest).encode()).hexdigest()
            git(work,'update-ref',ref,commit)
            git(work,'update-ref',ref+'-base',baseline)
            git(work,'bundle','create',str((dest/'source.bundle').resolve()),ref,ref+'-base')
            result={'commit':commit,'workerHead':worker_head,'originalBase':base or worker_head,'baseCommit':baseline,'baseTree':base_tree,'tree':tree,'manifest':before,'wallSeconds':time.monotonic()-start,'attempts':attempt+1}
            dump(dest/'snapshot.json',result);return result
    raise RuntimeError('kit-error: source changed during all bounded snapshot attempts')

def measurements(path):
    p=Path(path); tokens=None;calls=set();seen=False
    if not p.exists():return {'tokens':None,'toolCalls':None}
    for line in p.read_text(errors='replace').splitlines():
        try:x=json.loads(line)
        except json.JSONDecodeError:continue
        seen=True
        if x.get('type')=='turn.completed':tokens=x.get('usage')
        item=x.get('item',{})
        if item.get('type') in {'command_execution','mcp_tool_call','web_search','file_change','tool_call'} and item.get('id'):calls.add(item['id'])
    return {'tokens':tokens,'toolCalls':len(calls) if seen else None}

def parse_django(output,labels):
    # Split repeated headers on concatenated subTest progress lines.
    statuses={}
    def normal(s):return re.sub(r'^(test_\w+) \((.+)\.\1\)$',r'\1 (\2)',s)
    header=re.compile(r'(test_\w+) \(([^\n()]+)\)')
    matches=list(header.finditer(output))
    for i,m in enumerate(matches):
        tail=output[m.end(): matches[i+1].start() if i+1<len(matches) else len(output)]
        label=normal(m.group(1)+' ('+m.group(2)+')')
        status=re.search(r'\.\.\. (ok|FAIL|ERROR|skipped)\b',tail)
        if status:
            value={'ok':'pass','FAIL':'fail','ERROR':'fail','skipped':'skip'}[status.group(1)];statuses[label]=value
            for description in tail[:status.start()].splitlines():
                description=description.strip()
                if description in labels:statuses[description]=value
    for m in re.finditer(r'^(?:FAIL|ERROR): (test_\w+) \(([^\n()]+)\)',output,re.M):statuses[normal(m.group(1)+' ('+m.group(2)+')')]='fail'

    return {s:statuses.get(normal(s)) for s in labels}

def oracle(bundle,snapshot_commit,group,dataset,python,out):
    """Evaluate original benchmark tests on exactly the source snapshot tree."""
    out=Path(out);out.mkdir(exist_ok=False);work=out/'work'
    q=command(['git','init','--quiet',work]);assert q.returncode==0,q.stderr
    git(work,'fetch','--quiet',str(bundle),'refs/prereg-snapshots/*:refs/prereg-snapshots/*')
    git(work,'checkout','--quiet','--detach',snapshot_commit)
    tree=git(work,'rev-parse','HEAD^{tree}');results=[]
    base_snapshot=json.loads((Path(bundle).parent/'snapshot.json').read_text())['baseCommit']
    for task in group['tasks']:
        # Fresh checkout per task avoids tests contaminating peers.
        d=out/task['instance_id'];d.mkdir();w=d/'work'
        q=command(['git','clone','--shared','--quiet',work,w]);assert q.returncode==0,q.stderr
        git(w,'checkout','--quiet','--detach',snapshot_commit)
        patch=(Path(dataset)/task['testPatch']).read_text()
        paths=re.findall(r'^diff --git a/(\S+) b/',patch,re.M)
        for name in paths:
            q=command(['git','-C',w,'checkout',base_snapshot,'--',name])
            if q.returncode:
                # New benchmark test file can be absent at BASE; remove only this freshly created oracle clone file.
                target=w/name
                if target.exists():target.unlink()
        q=command(['git','apply','--whitespace=nowarn','-'],w,input=patch)
        if q.returncode:raise RuntimeError('kit-error: oracle test patch '+q.stderr)
        env={**os.environ,'PYTHONPATH':str(w),'TMPDIR':str(out.resolve()),'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1'}
        if task['repo']=='django/django':
            modules=sorted({s[len('tests/'):-3].replace('/','.') for s in paths if s.startswith('tests/') and Path(s).name.startswith('test') and s.endswith('.py')})
            cmd=[python,'tests/runtests.py','--verbosity','2','--settings=test_sqlite','--parallel','1',*modules]
        else:cmd=[python,'-m','pytest','-v','-rA','--tb=short','--junitxml='+str(d/'tests.xml'),*paths]
        q=command(cmd,w,env,timeout=300);output=q.stdout+q.stderr;(d/'tests.log').write_text(output);dump(d/'command.json',list(map(str,cmd)))
        labels=task['failToPass']+task['passToPass']
        if task['repo']=='django/django':statuses=parse_django(output,labels)
        else:
            seen={}
            if (d/'tests.xml').exists():
                for t in ET.parse(d/'tests.xml').iter('testcase'):seen[t.attrib['name']]='fail' if t.find('failure') is not None or t.find('error') is not None else 'skip' if t.find('skipped') is not None else 'pass'
            statuses={s:seen.get(s) for s in labels}
        result={'instanceId':task['instance_id'],'sourceTree':tree,'exitCode':q.returncode,'tests':statuses,'missing':sum(v is None for v in statuses.values()),'success':all(v=='pass' for v in statuses.values()) if all(v is not None for v in statuses.values()) else None}
        results.append(result)
    dump(out/'oracle.json',results);return results

def score(arm):
    errors=list(arm.get('kitErrors',[]));sessions=arm.get('sessions',[]);final=arm.get('finalOracle')
    if len(sessions)!=2:errors.append('missing sessions')
    for session in sessions:
        m=session.get('measurements') or {}
        if session.get('exitCode') is None or session.get('wallSeconds') is None or m.get('tokens') is None or m.get('toolCalls') is None:errors.append('missing session accounting')
    if final is None:errors.append('missing final oracle')
    if not arm.get('finalSnapshot') or any(t.get('sourceTree')!=arm.get('finalSnapshot',{}).get('tree') for t in final or []):errors.append('final oracle tree provenance mismatch')
    for session in sessions:
        if any(t.get('sourceTree')!=session.get('endSnapshot',{}).get('tree') for t in session.get('endOracle',[])):errors.append('end oracle tree provenance mismatch')
    losses=[]
    for s in sessions:
        if s.get('measurements') is None or s.get('endSnapshot') is None or s.get('endOracle') is None:errors.append('missing mandatory session evidence')
        end=next((x for x in s.get('endOracle',[]) if x['instanceId']==s['instanceId']),None)
        fin=next((x for x in final or [] if x['instanceId']==s['instanceId']),None)
        if end is None or fin is None or end.get('success') is None or fin.get('success') is None:errors.append('missing required oracle tests');loss=None
        else:loss=end['success'] and not fin['success']
        losses.append({'instanceId':s['instanceId'],'successfulAtEnd':end.get('success') if end else None,'successfulAtFinal':fin.get('success') if fin else None,'lost':loss,'silentLost':(loss and not arm.get('notifications')) if loss is not None and arm.get('notifications') is not None else None})
    return {'validity':'INVALID' if errors else 'VALID','kitErrors':errors,'losses':losses,'lostCount':sum(x['lost'] for x in losses) if all(x['lost'] is not None for x in losses) else None,'silentLostCount':sum(x['silentLost'] for x in losses) if all(x['silentLost'] is not None for x in losses) else None,'acceptedWriteLossCount':arm.get('acceptedWriteLossCount')}


def audit_atm(work):
    root=Path(work)/'.prereg-smoke';journal=Path(work)/'.atm/runtime/live-write-journal.jsonl'
    writes=[json.loads(s) for s in (root/'steward-writes.jsonl').read_text().splitlines()] if (root/'steward-writes.jsonl').exists() else []
    commits=[json.loads(s) for s in journal.read_text().splitlines() if s.strip()] if journal.exists() else []
    receipts=[];errors=[]
    for r in writes:
        if r.get('decision')=='kit-error':errors.append('writer kit-error: '+str(r.get('reasonCode')))
        if r.get('decision')!='accepted':continue
        candidates=[j for j in commits if j.get('proposalId')==r['proposalId'] and j.get('kind')=='committed']
        if len(candidates)!=1:errors.append('accepted receipt missing unique committed journal');continue
        j=candidates[0];p=subprocess.run(['git','-c','safe.directory=*','-C',str(work),'show',j['commitSha']+':'+j['file']],capture_output=True)
        actual='sha256:'+hashlib.sha256(p.stdout).hexdigest()
        verified=p.returncode==0 and actual==j.get('afterHash')
        if not verified:errors.append('accepted receipt commit bytes mismatch')
        receipts.append({'proposalId':r['proposalId'],'sessionSlot':r.get('sessionSlot'),'file':j['file'],'commitSha':j['commitSha'],'expectedAfterHash':j.get('afterHash'),'actualCommitHash':actual,'committedFileText':p.stdout.decode('utf-8'),'commitObject':git(work,'cat-file','-p',j['commitSha']),'verified':verified,'blocks':j.get('blocks'),'finalFileHash':'sha256:'+hashlib.sha256((Path(work)/j['file']).read_bytes()).hexdigest() if (Path(work)/j['file']).exists() else None})
    return {'receipts':receipts,'kitErrors':errors,'attempts':len(writes),'accepted':sum(r.get('decision')=='accepted' for r in writes),'rejected':sum(r.get('decision')=='rejected-by-design' for r in writes),'resubmissions':sum((r.get('attempt') or 1)>1 for r in writes),'acknowledgedOverlap':sum(bool(r.get('acknowledgedOverlap')) for r in writes)}


if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser(description='Read-only scoring of one archived arm result')
    ap.add_argument('result',type=Path)
    args=ap.parse_args()
    print(json.dumps(score(json.loads(args.result.read_text())),indent=2))
