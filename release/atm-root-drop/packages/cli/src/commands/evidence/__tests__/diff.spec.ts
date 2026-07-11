import assert from 'node:assert/strict';
import { CliError } from '../../shared.ts';
import { runEvidenceDiff } from '../verbs/diff.ts';

const taskId = 'TASK-RFT-0007';

try {
  runEvidenceDiff(['--json']);
  assert.fail('expected missing --task');
} catch (error) {
  assert.ok(error instanceof CliError);
}

const staged = runEvidenceDiff(['--task', taskId, '--staged', '--json']);
assert.equal(typeof staged.ok, 'boolean');

const again = runEvidenceDiff(['--task', taskId, '--staged', '--json']);
assert.equal(typeof again.ok, 'boolean');

console.log('[diff.spec] ok');
