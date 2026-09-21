import assert from 'node:assert/strict';
import { SCENARIOS, adjudicate, createAdjudicationInput, issueBlindAssignment, validateCorpusManifest, type CorpusManifest } from '../../scripts/lib/external-benchmark/oracle.ts';
const d=(c:string)=>'sha256:'+c.repeat(64);
const manifest:CorpusManifest={corpusId:'formal-1',version:'1.0.0',phase:'formal',scenarioClasses:[...SCENARIOS],promptDigest:d('a'),labelsDigest:d('b'),commitmentDigest:d('c'),sealedAt:'2026-09-13T00:00:00Z',ownerController:'custodian',pilotCorpusIds:['pilot-1']};
validateCorpusManifest(manifest); const assignment=issueBlindAssignment(manifest,'run-1','operator'); assert.equal(assignment.labelsVisible,false);
assert.throws(()=>issueBlindAssignment(manifest,'run-1','custodian'),/operator/); assert.throws(()=>validateCorpusManifest({...manifest,scenarioClasses:SCENARIOS.slice(0,5)}),/six/); assert.throws(()=>validateCorpusManifest({...manifest,corpusId:'pilot-1'}),/pilot/);
const input=createAdjudicationInput(manifest,assignment,new TextEncoder().encode('output'),'judge'); const result=adjudicate(input,{conflict:false},'judge','rubric-1',.9,false); assert.equal(result.disagreement,false); assert.equal(result.confidence,.9);
assert.throws(()=>createAdjudicationInput(manifest,{...assignment,labelsVisible:true} as unknown as typeof assignment,new Uint8Array([1]),'judge'),/blinded/); assert.throws(()=>adjudicate(input,{},'operator','rubric-1',.5,false),/self/); assert.throws(()=>adjudicate({...input,outputDigest:''},{},'judge','rubric-1',null,false),/output/);
console.log('external-benchmark-oracle ok');
