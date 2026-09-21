import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildBatchCheckpointCandidateSeal } from '../../packages/cli/src/commands/batch/implementation.ts';

const cwd = process.cwd();
const before = execFileSync('git', ['diff', '--cached', '--name-status'], { cwd, encoding: 'utf8' });
const result = buildBatchCheckpointCandidateSeal({ cwd, batchId: 'batch-foreign-state', taskId: 'ATM-GOV-0420', actorId: 'validator', laneSessionId: 'foreign-state-test' });
assert.equal(result.sourceAvailable, true);
assert.equal(result.laneSessionId, 'foreign-state-test');
const after = execFileSync('git', ['diff', '--cached', '--name-status'], { cwd, encoding: 'utf8' });
assert.equal(after, before, 'frozen-runner candidate inspection must preserve foreign staged entries');
console.log('[frozen-runner-validation-foreign-state.test] ok');
