import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildClosebackPlan} from '../../packages/cli/src/commands/taskflow/close-orchestration.ts';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'atm-planning-authority-'));
const target=path.join(root,'target');
const external=path.join(root,'planning','docs','task.md');
const local=path.join(target,'docs','task.md');
for(const file of [local,external]) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,'---\ntask_id: TASK-ROUTE\nstatus: running\n---\n');
}
function route(source:string, targetOwned:boolean) {
  return buildClosebackPlan({
    cwd:target,taskId:'TASK-ROUTE',actorId:'validator',historicalDeliveryRefs:[],
    taskDocument:targetOwned?{closureAuthority:'target_repo'}:{},
    delegationContract:{policy:{rosterSync:{indexPath:null},rosterSyncPolicy:'none'}},
    diagnosis:{bucket:'no-residue',truth:'test',residue:'test',reason:'test',nextCommand:'',
      triangulation:{liveLedger:{status:'running'},planningFrontmatter:{status:'running',source},divergence:[]}}
  } as any).writerBoundary.planningMirrorPath;
}
try {
  assert.equal(route(local,true),local,'target-owned same-repository card remains writable');
  assert.equal(route(external,true),null,'target-owned external planning authority remains read-only');
  assert.equal(route(external,false),external,'legacy cross-authority flow retains its explicit planning writer');
  console.log(JSON.stringify({ok:true,assertions:3}));
} finally {
  if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)) throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root,{recursive:true,force:true});
}
