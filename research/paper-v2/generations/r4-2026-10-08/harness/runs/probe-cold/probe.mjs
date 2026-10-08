// Probe: what does REAL ATM return for 2 concurrent same-file COLD intents?
import { loadAtmApis } from '../../src/real-broker.mjs';
const api = await loadAtmApis();
const mk = (task, atomId, file='src/index.ts', ls=3, le=5, proposal=false) => {
  const wi = { schemaId:'atm.writeIntent.v1', specVersion:'0.1.0', migration:{strategy:'none',fromVersion:null,notes:'probe'},
    taskId:task, actorId:'probe:'+task, baseCommit:'base', targetFiles:[file],
    atomRefs:[{atomId, atomCid:'cid-'+atomId, operation:'modify', sourceRange:{filePath:file,lineStart:ls,lineEnd:le}}],
    sharedSurfaces:{generators:[],projections:[],registries:[],validators:[],artifacts:[]}, requestedLane:'auto',
    leaseBounds:{requestedSeconds:120,maxSeconds:300} };
  if (proposal) wi.proposalAdmission = { trigger:'hot-file', summarySubmitted:true, hotFiles:[file], boundedRegions:[{filePath:file,lineStart:ls,lineEnd:le}], notes:'probe' };
  return wi;
};
const cases = {
  'A unique atomId per intent (current harness)': [mk('T1','atom-i1'), mk('T2','atom-i2')],
  'B stable atomId per path#region': [mk('T1','atom-index-body'), mk('T2','atom-index-body')],
  'C unique atom + requestedLane=serial': [mk('T1','atom-i1'), {...mk('T2','atom-i2'), requestedLane:'serial'}],
  'D unique atom + bounded proposal (cold)': [mk('T1','atom-i1',undefined,3,5,true), mk('T2','atom-i2',undefined,3,5,true)],
};
for (const [name,[a,b]] of Object.entries(cases)) {
  let reg = api.createEmptyBrokerRegistryDocument({ repoId:'p', workspaceId:'p' });
  const d1 = api.calculateBrokerDecision(a, reg);
  reg = api.registerIntent(reg, a, d1.lane==='blocked'?'direct-brokered':d1.lane, 120, d1.admission);
  const adm = api.evaluateBrokerAdmission({intent:b}, reg, {preferProposalForBoundedWork:true});
  console.log(JSON.stringify({ case:name, first:d1.verdict+'/'+d1.lane, second_verdict:adm.decision.verdict, second_lane:adm.decision.lane, disposition:adm.disposition, reason:adm.decision.reason }));
}
