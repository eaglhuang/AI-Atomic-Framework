// TASK-MAO-0049 acceptance test: task scope amendment audit lane.
//
// Verifies the two governed channels stay distinct and machine-readable:
//   - Normal audited lane: `tasks scope add` records class / phase / reason
//     without emergency approval.
//   - Emergency repair lane: `tasks scope repair` refuses to run without
//     `--emergency-approval` and `--reason`, and records mode = repair.
//
// Runnable as a closure-required validator via:
//   node --strip-types tests/cli/task-scope-amendment.test.ts

import assert from 'node:assert/strict';
import { CliError } from '../../packages/cli/src/commands/shared.ts';
import {
  parseScopeAddOptions,
  parseScopeRepairOptions
} from '../../packages/cli/src/commands/tasks/task-option-parsers.ts';
import { buildScopeAmendmentCommand } from '../../packages/cli/src/commands/tasks/task-transition-helpers.ts';

function expectCliError(fn: () => unknown, expectedCode: string, label: string) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CliError, `${label}: expected CliError, got ${String(error)}`);
    assert.equal((error as CliError).code, expectedCode, `${label}: unexpected error code`);
    return;
  }
  assert.fail(`${label}: expected CliError ${expectedCode} but nothing was thrown`);
}

// === Test A: normal audited lane parses class / phase / reason ===
{
  const options = parseScopeAddOptions([
    '--task', 'TASK-MAO-0049',
    '--actor', 'augment-code',
    '--claim-first',
    '--add', 'docs/a.md,docs/b.md',
    '--class', 'doc-sync',
    '--phase', 'closeout',
    '--reason', 'sync linked docs'
  ]);
  assert.equal(options.taskId, 'TASK-MAO-0049');
  assert.equal(options.actorId, 'augment-code');
  assert.equal(options.claimFirst, true);
  assert.deepEqual(options.addPaths, ['docs/a.md', 'docs/b.md']);
  assert.equal(options.amendmentClass, 'doc-sync');
  assert.equal(options.amendmentPhase, 'closeout');
  assert.equal(options.reason, 'sync linked docs');
  assert.equal(options.emergencyApproval, null);
  console.log('Test A normal audited lane parsing: PASS');
}

// === Test B: scope add requires --add and --task ===
expectCliError(
  () => parseScopeAddOptions(['--task', 'TASK-MAO-0049', '--actor', 'augment-code']),
  'ATM_CLI_USAGE',
  'Test B scope add without --add'
);
expectCliError(
  () => parseScopeAddOptions(['--actor', 'augment-code', '--add', 'docs/a.md']),
  'ATM_CLI_USAGE',
  'Test B scope add without --task'
);
console.log('Test B scope add required flags: PASS');

// === Test B2: scope add accepts --paths as a discoverability alias ===
{
  const options = parseScopeAddOptions([
    '--task', 'TASK-MAO-0049',
    '--actor', 'augment-code',
    '--paths', '"docs/a.md,docs/b.md"',
    '--reason', 'sync linked docs'
  ]);
  assert.deepEqual(options.addPaths, ['docs/a.md', 'docs/b.md']);
  assert.equal(options.reason, 'sync linked docs');
  console.log('Test B2 scope add --paths alias: PASS');
}

// === Test B3: scope add strips shell quote artifacts around CSV path tokens ===
{
  const options = parseScopeAddOptions([
    '--task', 'TASK-MAO-0049',
    '--actor', 'augment-code',
    '--add', '"docs/audit/first.json,docs/audit/second.json"',
    '--reason', 'PowerShell JSON surface quote normalization'
  ]);
  assert.deepEqual(options.addPaths, ['docs/audit/first.json', 'docs/audit/second.json']);

  const splitArtifact = parseScopeAddOptions([
    '--task', 'TASK-MAO-0049',
    '--actor', 'augment-code',
    '--add', '"docs/audit/first.json,docs/audit/second.json',
    '--reason', 'leading quote artifact'
  ]);
  assert.deepEqual(splitArtifact.addPaths, ['docs/audit/first.json', 'docs/audit/second.json']);

  const trailingArtifact = parseScopeAddOptions([
    '--task', 'TASK-MAO-0049',
    '--actor', 'augment-code',
    '--add', 'docs/audit/first.json,docs/audit/second.json"',
    '--reason', 'trailing quote artifact'
  ]);
  assert.deepEqual(trailingArtifact.addPaths, ['docs/audit/first.json', 'docs/audit/second.json']);
  console.log('Test B3 scope add quote artifact normalization: PASS');
}

// === Test C: repair lane refuses without emergency approval ===
expectCliError(
  () => parseScopeRepairOptions([
    '--task', 'TASK-MAO-0049',
    '--actor', 'augment-code',
    '--add', 'docs/a.md',
    '--reason', 'emergency closeout fix'
  ]),
  'ATM_SCOPE_REPAIR_EMERGENCY_APPROVAL_REQUIRED',
  'Test C repair without --emergency-approval'
);
console.log('Test C repair lane emergency-approval guard: PASS');

// === Test D: repair lane requires --reason ===
expectCliError(
  () => parseScopeRepairOptions([
    '--task', 'TASK-MAO-0049',
    '--actor', 'augment-code',
    '--add', 'docs/a.md',
    '--emergency-approval', 'lease-123'
  ]),
  'ATM_CLI_USAGE',
  'Test D repair without --reason'
);
console.log('Test D repair lane reason requirement: PASS');

// === Test E: repair lane parses a complete maintenance request ===
{
  const options = parseScopeRepairOptions([
    '--task', 'TASK-MAO-0049',
    '--actor', 'augment-code',
    '--add', 'release/atm-onefile/atm.mjs',
    '--reason', 'restore generated release artifact',
    '--emergency-approval', 'lease-123'
  ]);
  assert.equal(options.emergencyApproval, 'lease-123');
  assert.equal(options.reason, 'restore generated release artifact');
  assert.deepEqual(options.addPaths, ['release/atm-onefile/atm.mjs']);
  console.log('Test E repair lane full parse: PASS');
}

// === Test F: command builder keeps the two channels distinct ===
{
  const normal = buildScopeAmendmentCommand({
    mode: 'normal',
    taskId: 'TASK-MAO-0049',
    actorId: 'augment-code',
    addPaths: ['docs/a.md'],
    amendmentClass: 'doc-sync',
    amendmentPhase: 'closeout',
    reason: 'sync linked docs'
  });
  assert.ok(normal.includes('tasks scope add'), 'normal builds the add sub-action');
  assert.ok(normal.includes('--class doc-sync'), 'normal carries the amendment class');
  assert.ok(normal.includes('--phase closeout'), 'normal carries the amendment phase');
  assert.ok(!normal.includes('--emergency-approval'), 'normal must not carry emergency approval');

  const repair = buildScopeAmendmentCommand({
    mode: 'repair',
    taskId: 'TASK-MAO-0049',
    actorId: 'augment-code',
    addPaths: ['release/atm-onefile/atm.mjs'],
    reason: 'restore generated release artifact',
    emergencyApproval: 'lease-123'
  });
  assert.ok(repair.includes('tasks scope repair'), 'repair builds the repair sub-action');
  assert.ok(repair.includes('--emergency-approval lease-123'), 'repair carries emergency approval');
  assert.ok(!repair.includes('--class'), 'repair must not carry an amendment class');
  assert.ok(!repair.includes('--phase'), 'repair must not carry an amendment phase');
  console.log('Test F command builder channel separation: PASS');
}

console.log('TASK-MAO-0049 task scope amendment audit lane: ALL PASS');
