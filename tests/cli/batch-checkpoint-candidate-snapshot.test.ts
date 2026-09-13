import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildBatchCheckpointCandidateSeal } from '../../packages/cli/src/commands/batch/implementation.ts';

const cwd = process.cwd();
const before = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' });
const seal = buildBatchCheckpointCandidateSeal({ cwd, batchId: 'batch-test', taskId: 'ATM-GOV-0420', actorId: 'validator' });
assert.equal(seal.schemaId, 'atm.batchCheckpointCandidateSeal.v1');
assert.equal(seal.sourceAvailable, true, 'candidate seal must be backed by an immutable index tree');
assert.match(seal.candidateDigest ?? '', /^sha256:[a-f0-9]{64}$/);
assert.ok(['head-bound', 'candidate-diff'].includes(seal.runnerRelationship));
const after = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' });
assert.equal(after, before, 'candidate snapshot must not mutate the real index or foreign staged state');
console.log('[batch-checkpoint-candidate-snapshot.test] ok');
