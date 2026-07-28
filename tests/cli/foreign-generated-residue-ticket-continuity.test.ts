import assert from 'node:assert/strict';
import { classifyForeignGeneratedResidue } from '../../packages/core/src/broker/index.ts';
import { issueWorkAdmissionTicket } from '../../packages/core/src/broker/work-admission-ticket.ts';

const content = JSON.stringify({
  schemaId: 'atm.skillCorpusAudit.v1',
  specVersion: '0.1.0',
  taskId: 'TASK-SKL-0028',
  generatedAt: '1970-01-01T00:00:00.000Z',
  sourceSnapshot: {
    schemaId: 'atm.skillCorpusSourceSnapshot.v1',
    sourceDigest: 'sha256:ac249182061e9147ec9bba16419a7d79c8b9b3feab160454f1ba59279fa1aec2'
  }
});

const deferred = classifyForeignGeneratedResidue({
  path: 'artifacts/generated/skill-corpus-audit.json',
  content,
  candidateTaskId: 'TASK-GIT-0022',
  producerDeclaresPath: true,
  runnerInventoryMember: false
});
assert.equal(deferred.state, 'deferred');
assert.equal(deferred.provenance?.producerTaskId, 'TASK-SKL-0028');

const ticket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0022',
  actorId: 'captain',
  claimGeneration: 'lease-1',
  allowedFiles: ['packages/cli/src/example.ts'],
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'release/atm-onefile/atm.mjs', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z',
  deferredForeignResidue: deferred.provenance ? [deferred.provenance] : []
});
assert.equal(ticket.deferredForeignResidue.length, 1);
assert.equal(ticket.grants.find((grant) => grant.kind === 'file-write')?.values.includes('artifacts/generated/skill-corpus-audit.json'), false);

const runnerMember = classifyForeignGeneratedResidue({
  path: 'packages/cli/dist/atm.js',
  content,
  candidateTaskId: 'TASK-GIT-0022',
  producerDeclaresPath: true,
  runnerInventoryMember: true
});
assert.equal(runnerMember.state, 'blocked');

const unverifiable = classifyForeignGeneratedResidue({
  path: 'artifacts/generated/unknown.json',
  content: '{"taskId":"TASK-SKL-0028"}',
  candidateTaskId: 'TASK-GIT-0022',
  producerDeclaresPath: true,
  runnerInventoryMember: false
});
assert.equal(unverifiable.state, 'blocked');

console.log('[foreign-generated-residue-ticket-continuity] ok');
