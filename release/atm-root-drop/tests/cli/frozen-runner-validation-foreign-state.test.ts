import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBatchCheckpointCandidateSeal } from '../../packages/cli/src/commands/batch/implementation.ts';

// Inspect a real foreign staged entry without competing for the sweep's index.
const cwd = mkdtempSync(path.join(tmpdir(), 'atm-foreign-state-'));
const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
try {
  git(['init', '-q']);
  git(['-c', 'user.name=ATM Test', '-c', 'user.email=atm-test@example.invalid',
    'commit', '--allow-empty', '-qm', 'fixture base']);
  writeFileSync(path.join(cwd, 'foreign.txt'), 'foreign staged content\n');
  git(['add', 'foreign.txt']);
  const before = git(['diff', '--cached', '--name-status']);
  const result = buildBatchCheckpointCandidateSeal({ cwd, batchId: 'batch-foreign-state', taskId: 'ATM-GOV-0420', actorId: 'validator', laneSessionId: 'foreign-state-test' });
  assert.equal(result.sourceAvailable, true);
  assert.equal(result.laneSessionId, 'foreign-state-test');
  assert.equal(result.runnerRelationship, 'candidate-diff');
  assert.deepEqual(result.stagedFiles, ['foreign.txt']);
  const after = git(['diff', '--cached', '--name-status']);
  assert.equal(after, before, 'frozen-runner candidate inspection must preserve foreign staged entries');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
console.log('[frozen-runner-validation-foreign-state.test] ok');
