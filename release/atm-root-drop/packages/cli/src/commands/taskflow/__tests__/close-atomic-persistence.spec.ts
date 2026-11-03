import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const module = pathToFileURL(path.resolve('packages/cli/src/commands/taskflow/close-attempt.ts')).href;
const childSource=String.raw`
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const [module,file,signal,operation,side]=process.argv.slice(1);
const old={open:fs.openSync,write:fs.writeFileSync,sync:fs.fsyncSync,rename:fs.renameSync};
const fds=new Map();
const hit=(op,when)=>{ if(op===operation && when===side){ old.write(signal,'ready'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0); } };
fs.openSync=(file,...args)=>{ const fd=old.open(file,...args); fds.set(fd,String(file)); return fd; };
fs.writeFileSync=(file,...args)=>{ const op=typeof file==='number'?'write':null;hit(op,'before');const r=old.write(file,...args);hit(op,'after');return r; };
fs.fsyncSync=fd=>{ const op=fds.get(fd)?.endsWith('.tmp')?'file-fsync':'directory-fsync';hit(op,'before');const r=old.sync(fd);hit(op,'after');return r; };
fs.renameSync=(...args)=>{hit('rename','before');const r=old.rename(...args);hit('rename','after');return r;};
syncBuiltinESMExports();
const { writeCloseAtomic }=await import(module);
writeCloseAtomic(file,JSON.stringify({version:'new',payload:'x'.repeat(65536)}));
`;
for(const operation of ['write','file-fsync','rename','directory-fsync']) for(const side of ['before','after']) {
  if(operation==='directory-fsync' && process.platform==='win32') continue;
  const root=mkdtempSync(path.join(os.tmpdir(),'atm-persistence-atomic-'));
  const file=path.join(root,'state.json'), signal=path.join(root,'ready');
  writeFileSync(file,JSON.stringify({version:'old'}));
  const child=spawn(process.execPath,['--strip-types','--input-type=module','-e',childSource,module,file,signal,operation,side],{stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr?.on('data',b=>{stderr+=b;});
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  try {
    const deadline=Date.now()+15000;
    while(!existsSync(signal) && child.exitCode===null && Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
    assert.ok(existsSync(signal),`${operation} ${side} ${stderr}`);
    child.kill('SIGKILL');await exited;
    const record=JSON.parse(readFileSync(file,'utf8'));
    assert.ok(record.version==='old'||record.version==='new');
    if(record.version==='new')assert.equal(record.payload,'x'.repeat(65536));
    if(operation==='write'||operation==='file-fsync'||(operation==='rename'&&side==='before'))assert.equal(record.version,'old');
  } finally { if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}rmSync(root,{recursive:true,force:true}); }
}
console.log('atomic persistence: SIGKILL before/after write, file fsync, rename and directory fsync leaves complete old/new state');
