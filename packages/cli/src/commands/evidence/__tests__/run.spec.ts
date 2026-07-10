import assert from 'node:assert/strict';
import { CliError } from '../../shared.ts';
import { runEvidenceRun } from '../verbs/run.ts';

const cwd = process.cwd();
const actor = 'cursor-composer-rft0007';
const taskId = 'TASK-RFT-0007';

const pass = runEvidenceRun([
  '--task', taskId,
  '--cwd', cwd,
  '--actor', actor,
  '--command', 'node -e "process.exit(0)"',
  '--validators', 'rft0007-pass-probe',
  '--runner-kind', 'dev-source',
  '--json'
]);
assert.equal(pass.ok, true);

let failed = false;
try {
  runEvidenceRun([
    '--task', taskId,
    '--cwd', cwd,
    '--actor', actor,
    '--command', 'node -e "process.exit(7)"',
    '--validators', 'rft0007-fail-probe',
    '--runner-kind', 'dev-source',
    '--json'
  ]);
} catch (error) {
  assert.ok(error instanceof CliError);
  assert.equal(error.code, 'ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND');
  failed = true;
}
assert.equal(failed, true);

const recent = runEvidenceRun([
  '--task', taskId,
  '--cwd', cwd,
  '--actor', actor,
  '--command', 'node -e "process.exit(0)"',
  '--validators', 'rft0007-recent-probe',
  '--runner-kind', 'dev-source',
  '--recent-run',
  '--json'
]);
assert.equal(typeof recent.ok, 'boolean');

console.log('[run.spec] ok');
