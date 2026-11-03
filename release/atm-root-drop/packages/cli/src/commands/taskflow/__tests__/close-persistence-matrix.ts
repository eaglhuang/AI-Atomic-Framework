import { availableParallelism } from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeDualRepoCloseFixture, writeJson } from './dryrun/fixtures.ts';
import { runTaskflow } from '../../taskflow.ts';
import { inspectCloseRecovery } from '../close-recovery.ts';
import { readCloseTransactionStatus } from '../close-transaction-status.ts';
import { writeCloseAttempt } from '../close-attempt.ts';
import { queryCloseAttempt } from '../close-detach.ts';

// Fault injection stays in child processes. No product kill switches or manually
// edited production state: each close runs against an isolated valid fixture.
const runner = String.raw`
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const input = JSON.parse(process.argv[1]);
const opened=new Map();
const original = { sync: fs.fsyncSync, open: fs.openSync, rename: fs.renameSync, write: fs.writeFileSync, read: fs.readFileSync, rm: fs.rmSync, unlink: fs.unlinkSync, exec: cp.execFileSync };
const hit = (kind, side) => {
 if(kind !== input.boundary || side !== input.side) return;
 original.write(input.signal, kind);
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
};
function classify(file, text) {
 const name=String(file);
 if(name.endsWith('.tmp')) return null;
 let doc; try { doc=JSON.parse(String(text)); } catch {}
 if(name.endsWith('.close-recovery.json')) return 'recovery-receipt';
 if(name.endsWith('.owner')) return 'owner';
 if(name.endsWith('.lock.json') && doc?.schemaId==='atm.closeTransactionMutexLease.v1') return 'mutex';
 if(name.endsWith('/history/tasks/'+input.task+'.json') && doc?.status==='done') return 'ledger';
 if(name.includes('/history/task-events/'+input.task+'/') && doc?.action==='close' && doc?.taskPath?.endsWith(input.task+'.json')) return 'close-event';
 if(name.endsWith('.candidate.json')) return 'candidate';
 if(name.endsWith('.rollback-snapshot.json')) return 'rollback';
 if(name.endsWith('.result')) return 'result';
 if(name.endsWith('.seal-and-commit.json')) return 'seal';
 if(name.endsWith(input.attempt+'.json') && doc?.state) return 'attempt-'+doc.state;
 if(name.endsWith('close-window-staged-index.lock.json')) return doc?.foreignStagedEntries?.length ? 'window-prepared' : 'window-initial';
 if(name.includes('close-window-foreign-staged-')) return 'foreign-snapshot';
 if(name.endsWith('/close-transactions/'+input.task+'.json')) return 'transaction-'+doc?.phase;
 return null;
}
fs.fsyncSync=(fd)=> { const file=opened.get(fd); const kind=file?.endsWith('/.git/index')?'index-fsync':file?.endsWith('/runtime/locks')?(fs.existsSync(file+'/close-window-staged-index.lock.json')?'window-directory-fsync':'window-release-fsync'):null; hit(kind,'before'); const value=original.sync(fd); hit(kind,'after'); return value; };
fs.renameSync=(from,to)=> { const kind=classify(to,original.read(from)); hit(kind,'before'); const value=original.rename(from,to); hit(kind,'after'); return value; };
fs.openSync=(file,...args)=>{const fd=original.open(file,...args);opened.set(fd,String(file));return fd;};
fs.writeFileSync=(file,text,...args)=> { const kind=classify(typeof file==='number'?opened.get(file):file,text); hit(kind,'before'); const value=original.write(file,text,...args); hit(kind,'after'); return value; };
fs.unlinkSync=(file)=> { const kind=String(file).endsWith('close-window-staged-index.lock.json')?'window-release':null; hit(kind,'before'); const value=original.unlink(file); hit(kind,'after'); return value; };
fs.rmSync=(file,...args)=> { const kind=String(file).endsWith('.rollback-snapshot.json')?'snapshot-clear':String(file).endsWith('.candidate.json')?'candidate-clear':null; hit(kind,'before'); const value=original.rm(file,...args); hit(kind,'after'); return value; };
cp.execFileSync=(command,args,...options)=> { const kind=args?.includes('commit') ? (String(options[0]?.cwd).endsWith('/planning')?'planning-commit':'target-commit') : args?.[0]==='restore' && args.includes('--staged') ? 'park-index' : null; hit(kind,'before'); const value=original.exec(command,args,...options); hit(kind,'after'); return value; };
syncBuiltinESMExports();
const { runTaskflow } = await import(input.module);
const result = await runTaskflow(input.argv);
if (!result.ok) throw new Error(JSON.stringify(result.messages));
`;

export async function runPersistenceMatrix(side: 'before' | 'after', selected?: string[]) {
  const boundaries = ['owner','attempt-running','candidate','mutex','window-initial','foreign-snapshot','window-prepared','park-index','rollback', 'transaction-started','close-event','ledger','transaction-ledger-written','seal','target-commit','planning-commit','index-fsync','window-release','window-directory-fsync','window-release-fsync','transaction-post-cleanup-complete','snapshot-clear','candidate-clear','attempt-completed','result'];
  const module = pathToFileURL(path.resolve('packages/cli/src/commands/taskflow.ts')).href;
  await runCloseCases(selected ?? boundaries, async (boundary) => {
    const f = await makeDualRepoCloseFixture(`persistence-${side}-${boundary}`, { closePlanningStatus: 'running' });
    const root = path.dirname(f.targetRepo);
    const task = f.taskId;
    const git = (args: string[]) => execFileSync('git', args, { cwd: f.targetRepo, encoding: 'utf8' });
    const taskFile=path.join(f.targetRepo,'.atm/history/tasks',task+'.json');
    const lane=JSON.parse(readFileSync(taskFile,'utf8')).claim.laneSession.laneSessionId;
    const foreign='.atm/history/tasks/TASK-FOREIGN.json';
    writeJson(path.join(f.targetRepo,foreign),{workItemId:'TASK-FOREIGN',status:'running',claim:{actorId:'other',leaseId:'other',state:'active',heartbeatAt:new Date().toISOString(),ttlSeconds:3600,files:[foreign]}});
    git(['add',foreign]);
    const identity=git(['ls-files','-s','--',foreign]);
    const attempt='attempt-matrix';
    const now=new Date().toISOString();
    writeCloseAttempt(f.targetRepo,{schemaId:'atm.closeAttempt.v1',taskId:task,attemptId:attempt,actorId:'validator',state:'starting',startedAt:now,updatedAt:now,ownerPid:null,targetCommit:null,failure:null});
    const signal=path.join(root,'boundary');
    const argv=['close','--cwd',f.targetRepo,'--profile',f.profilePath,'--task',task,'--actor','validator','--historical-delivery',f.deliveryCommit,'--defer-foreign-staged','--write'];
    const child=spawn(process.execPath,['--strip-types','--input-type=module','-e',runner,JSON.stringify({module,argv,task,attempt,boundary,side,signal})],{env:{...process.env,ATM_LANE_SESSION_ID:lane,ATM_CLOSE_ATTEMPT_TASK:task,ATM_CLOSE_ATTEMPT_ID:attempt},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    let output=''; child.stdout?.on('data',s=>{output+=s;}); child.stderr?.on('data',s=>{output+=s;});
    const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
    try {
      const deadline=Date.now()+45000;
      while (!existsSync(signal) && child.exitCode===null && child.signalCode===null && Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
      assert.ok(existsSync(signal),`${side} ${boundary} was not reached (exit=${child.exitCode} signal=${child.signalCode}): ${output.slice(-4000)}`);
      const tx=readCloseTransactionStatus(f.targetRepo,task);
      if(tx?.outcome==='completed') assert.ok(!existsSync(path.join(f.targetRepo,'.atm/runtime/locks/close-window-staged-index.lock.json')),'terminal requires cleaned index window');
      if(process.platform==='win32') child.kill('SIGKILL'); else process.kill(-child.pid!,'SIGKILL');
      await exited;
      if (side==='after' && boundary==='target-commit') {
        writeJson(path.join(f.targetRepo,foreign),{workItemId:'TASK-FOREIGN',status:'running',newer:'another writer staged after parking'});
        git(['add',foreign]); const newer=git(['ls-files','-s','--',foreign]);
        await assert.rejects(runTaskflow(['close','--cwd',f.targetRepo,'--task',task,'--actor','validator','--recover','--write','--stale-after-ms','0']),/Foreign index changed/);
        assert.equal(git(['ls-files','-s','--',foreign]),newer,'failed cleanup preserves newer staging');
        assert.notEqual(readCloseTransactionStatus(f.targetRepo,task)?.outcome,'completed','cleanup failure cannot publish completed');
        assert.ok(existsSync(path.join(f.targetRepo,'.atm/runtime/locks/close-window-staged-index.lock.json')));
        git(['restore','--staged','--',foreign]);
      }
      const inspection=inspectCloseRecovery({cwd:f.targetRepo,taskId:task,staleAfterMs:0});
      assert.notEqual(inspection.state,'holder-alive');
      if(inspection.state!=='nothing-to-recover') {
        const mode=inspection.landed?'--recover':'--abort';
        const recoverArgs=['close','--cwd',f.targetRepo,'--task',task,'--actor','validator',mode,'--stale-after-ms','0'];
        const dry=await runTaskflow(recoverArgs); assert.equal(dry.ok,true,JSON.stringify(dry.messages));
        const fixed=await runTaskflow([...recoverArgs,'--write']); assert.equal(fixed.ok,true,JSON.stringify(fixed.messages));
        const head=git(['rev-parse','HEAD']);
        const replay=await runTaskflow([...recoverArgs,'--write']); assert.equal(replay.ok,true,JSON.stringify(replay.messages));
        assert.equal(git(['rev-parse','HEAD']),head,'replay cannot create another effective close');
      }
      assert.equal(git(['ls-files','-s','--',foreign]),identity,`${side} ${boundary}: foreign staged blob/mode preserved`);
      const eventDir=path.join(f.targetRepo,'.atm/history/task-events',task);
      const closeEvents=existsSync(eventDir)?readdirSync(eventDir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(path.join(eventDir,n),'utf8'))).filter(e=>e.action==='close' && e.taskPath===`.atm/history/tasks/${task}.json`):[];
      assert.ok(closeEvents.length<=1,'at most one effective close event');
      const status=await queryCloseAttempt({cwd:f.targetRepo,taskId:task,attemptId:attempt});
      if(!inspection.landed) assert.doesNotMatch(status.closeResultLine,/CLOSE_COMMITTED/,'started never means committed');
      console.log(`persistence ${side} ${boundary}: safe ${inspection.landed?'recover':'abort/no-write'}`);
    } finally {
      if(child.exitCode===null && child.signalCode===null) { try { if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid!,'SIGKILL'); } catch {} await exited; }
      rmSync(root,{recursive:true,force:true});
    }
  });
}

export async function runRecoveryPersistenceMatrix() {
  const module = pathToFileURL(path.resolve('packages/cli/src/commands/taskflow.ts')).href;
  const cases = ['recover','abort'].flatMap(mode => ['before','after'].flatMap(side =>
    ['window-release','recovery-receipt',mode==='recover'?'transaction-post-cleanup-complete':'transaction-rolled-back'].map(boundary => ({ mode, side, boundary }))));
  await runCloseCases(cases, async ({ mode, side, boundary }) => {
      const f=await makeDualRepoCloseFixture(`replay-${mode}-${side}-${boundary}`,{closePlanningStatus:'running'});
      const root=path.dirname(f.targetRepo), task=f.taskId, attempt='attempt-recovery';
      const git=(args:string[])=>execFileSync('git',args,{cwd:f.targetRepo,encoding:'utf8'});
      const ledger=JSON.parse(readFileSync(path.join(f.targetRepo,'.atm/history/tasks',task+'.json'),'utf8'));
      const foreign='.atm/history/tasks/TASK-FOREIGN.json';
      writeJson(path.join(f.targetRepo,foreign),{workItemId:'TASK-FOREIGN',status:'running',claim:{actorId:'other',leaseId:'other',state:'active',heartbeatAt:new Date().toISOString(),ttlSeconds:3600,files:[foreign]}});git(['add',foreign]);
      const identity=git(['ls-files','-s','--',foreign]);
      const now=new Date().toISOString();
      writeCloseAttempt(f.targetRepo,{schemaId:'atm.closeAttempt.v1',taskId:task,attemptId:attempt,actorId:'validator',state:'starting',startedAt:now,updatedAt:now,ownerPid:null,targetCommit:null,failure:null});
      async function killAt(argv:string[], point:string, when:string, sequence:number) {
        const signal=path.join(root,'signal-'+sequence);
        const child=spawn(process.execPath,['--strip-types','--input-type=module','-e',runner,JSON.stringify({module,argv,task,attempt,boundary:point,side:when,signal})],{env:{...process.env,ATM_LANE_SESSION_ID:ledger.claim.laneSession.laneSessionId,ATM_CLOSE_ATTEMPT_TASK:task,ATM_CLOSE_ATTEMPT_ID:attempt},stdio:['ignore','ignore','pipe'],detached:process.platform!=='win32'});
        let stderr='';child.stderr?.on('data',s=>{stderr+=s;});const exited=new Promise<void>(r=>child.once('exit',()=>r()));
        try {
          const deadline=Date.now()+45000;
          while(!existsSync(signal)&&child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
          assert.ok(existsSync(signal),`${mode} ${point} ${when}: ${stderr.slice(-3000)}`);
          const tx=readCloseTransactionStatus(f.targetRepo,task);
          if(tx?.outcome==='completed'||tx?.outcome==='rolled-back') {
            assert.ok(!existsSync(path.join(f.targetRepo,'.atm/runtime/locks/close-window-staged-index.lock.json')));
            assert.equal(git(['ls-files','-s','--',foreign]),identity);
          }
        } finally {
          if(child.exitCode===null&&child.signalCode===null){try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid!,'SIGKILL');}catch{}}
          await exited;
        }
      }
      try {
        const closeArgs=['close','--cwd',f.targetRepo,'--profile',f.profilePath,'--task',task,'--actor','validator','--historical-delivery',f.deliveryCommit,'--defer-foreign-staged','--write'];
        await killAt(closeArgs,mode==='recover'?'target-commit':'transaction-ledger-written','after',1);
        const args=['close','--cwd',f.targetRepo,'--task',task,'--actor','validator','--'+mode,'--stale-after-ms','0','--write'];
        await killAt(args,boundary,side,2);
        const fixed=await runTaskflow(args);assert.equal(fixed.ok,true,JSON.stringify(fixed.messages));
        const head=git(['rev-parse','HEAD']);
        const replay=await runTaskflow(args);assert.equal(replay.ok,true,JSON.stringify(replay.messages));
        assert.equal(git(['rev-parse','HEAD']),head);assert.equal(git(['ls-files','-s','--',foreign]),identity);
        console.log(`recovery ${mode} ${side} ${boundary}: safe replay`);
      } finally {rmSync(root,{recursive:true,force:true});}
  });
}

export async function runConcurrentCloseMatrix() {
  const f=await makeDualRepoCloseFixture('concurrent-attempts',{closePlanningStatus:'running'});
  const root=path.dirname(f.targetRepo), task=f.taskId;
  const git=(args:string[])=>execFileSync('git',args,{cwd:f.targetRepo,encoding:'utf8'});
  const lane=JSON.parse(readFileSync(path.join(f.targetRepo,'.atm/history/tasks',task+'.json'),'utf8')).claim.laneSession.laneSessionId;
  const foreign='.atm/history/tasks/TASK-FOREIGN.json';
  writeJson(path.join(f.targetRepo,foreign),{workItemId:'TASK-FOREIGN',status:'running',claim:{actorId:'other',leaseId:'other',state:'active',heartbeatAt:new Date().toISOString(),ttlSeconds:3600,files:[foreign]}});git(['add',foreign]);
  const identity=git(['ls-files','-s','--',foreign]), before=git(['rev-parse','HEAD']).trim();
  const module=pathToFileURL(path.resolve('packages/cli/src/commands/taskflow.ts')).href;
  const children: ReturnType<typeof spawn>[]=[];
  try {
    const results=await Promise.all(['attempt-one','attempt-two'].map(async attempt=>{
      const now=new Date().toISOString();
      writeCloseAttempt(f.targetRepo,{schemaId:'atm.closeAttempt.v1',taskId:task,attemptId:attempt,actorId:'validator',state:'starting',startedAt:now,updatedAt:now,ownerPid:null,targetCommit:null,failure:null});
      const argv=['close','--cwd',f.targetRepo,'--profile',f.profilePath,'--task',task,'--actor','validator','--historical-delivery',f.deliveryCommit,'--defer-foreign-staged','--write'];
      const child=spawn(process.execPath,['--strip-types','--input-type=module','-e',runner,JSON.stringify({module,argv,task,attempt,boundary:'never',side:'never',signal:path.join(root,attempt)})],{env:{...process.env,ATM_LANE_SESSION_ID:lane,ATM_CLOSE_ATTEMPT_TASK:task,ATM_CLOSE_ATTEMPT_ID:attempt},stdio:['ignore','ignore','pipe']});
      children.push(child);let stderr='';child.stderr?.on('data',s=>{stderr+=s;});
      return await new Promise<{code:number|null;stderr:string}>(resolve=>{
        const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
        child.once('exit',code=>{clearTimeout(timer);resolve({code,stderr});});
      });
    }));
    assert.ok(results.some(r=>r.code===0),JSON.stringify(results));
    assert.equal(git(['log','--format=%H',`${before}..HEAD`,'--',`.atm/history/tasks/${task}.json`]).trim().split('\n').filter(Boolean).length,1,'one effective close commit');
    const statuses=await Promise.all(['attempt-one','attempt-two'].map(attemptId=>queryCloseAttempt({cwd:f.targetRepo,taskId:task,attemptId})));
    assert.equal(statuses.filter(s=>s.closeResultLine.includes('CLOSE_COMMITTED')).length,1,'one committed attempt; another attempt cannot borrow success');
    assert.equal(git(['ls-files','-s','--',foreign]),identity);
    console.log('concurrent attempts: one effective close; attempt identity and foreign index preserved');
  } finally {
    for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    rmSync(root,{recursive:true,force:true});
  }
}

/** Each case owns a separate repository/process group. Drain cleanup on failure. */
async function runCloseCases<T>(cases: readonly T[], run: (value: T) => Promise<void>): Promise<void> {
  const concurrency = Math.max(1, Math.min(4, availableParallelism()));
  let next = 0;
  let failure: unknown;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
    while (!failed && next < cases.length) {
      const value = cases[next++];
      try { await run(value); } catch (error) { failed = true; failure = error; }
    }
  }));
  if (failed) throw failure;
}
