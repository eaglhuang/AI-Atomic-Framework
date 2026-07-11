import assert from 'node:assert/strict';
import { CliError } from '../../shared.ts';
import { runEvidenceAdd } from '../verbs/add.ts';

const cwd = process.cwd();
const taskId = 'TASK-RFT-0007';
const actor = 'cursor-composer-rft0007';

try {
  runEvidenceAdd(['--task', taskId, '--cwd', cwd, '--command', 'npm run typecheck', '--json']);
  assert.fail('expected missing --kind to throw');
} catch (error) {
  assert.ok(error instanceof CliError);
}

const first = runEvidenceAdd([
  '--task', taskId,
  '--cwd', cwd,
  '--actor', actor,
  '--kind', 'test',
  '--command', 'npm run typecheck',
  '--exit-code', '0',
  '--stdout-sha256', 'sha256:' + 'a'.repeat(64),
  '--stderr-sha256', 'sha256:' + 'b'.repeat(64),
  '--validators', 'typecheck',
  '--summary', 'rft0007-add-spec',
  '--json'
]);
assert.equal(first.ok, true);

const second = runEvidenceAdd([
  '--task', taskId,
  '--cwd', cwd,
  '--actor', actor,
  '--kind', 'test',
  '--command', 'npm run typecheck',
  '--exit-code', '0',
  '--stdout-sha256', 'sha256:' + 'a'.repeat(64),
  '--stderr-sha256', 'sha256:' + 'b'.repeat(64),
  '--validators', 'typecheck',
  '--summary', 'rft0007-add-spec',
  '--json'
]);
assert.equal(typeof second.ok, 'boolean');

console.log('[add.spec] ok');
