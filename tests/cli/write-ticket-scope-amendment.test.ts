import assert from 'node:assert/strict';
import { parseScopeAddCommandPaths } from '../../packages/cli/src/commands/tasks/status-triangulation.ts';
import { parseScopeAddOptions } from '../../packages/cli/src/commands/tasks/task-option-parsers.ts';
import { acquireWriteTicket, checkWriteTicket } from '../../packages/core/src/broker/write-ticket.ts';

const quoted = parseScopeAddOptions([
  '--task', 'TASK-WRITE-0002',
  '--actor', 'actor-a',
  '--add', '"packages/cli/src/commands/framework-development/runner-sync-admission.ts,tests/cli/runner-sync-build-actor-continuity.test.ts"',
  '--reason', 'linked surface'
]);
assert.deepEqual(quoted.addPaths, [
  'packages/cli/src/commands/framework-development/runner-sync-admission.ts',
  'tests/cli/runner-sync-build-actor-continuity.test.ts'
]);

const leading = parseScopeAddOptions([
  '--task', 'TASK-WRITE-0002',
  '--actor', 'actor-a',
  '--add', '"packages/cli/src/commands/framework-development/runner-sync-admission.ts,tests/cli/runner-sync-build-actor-continuity.test.ts',
  '--reason', 'leading quote'
]);
assert.deepEqual(leading.addPaths, quoted.addPaths);

const trailing = parseScopeAddOptions([
  '--task', 'TASK-WRITE-0002',
  '--actor', 'actor-a',
  '--add', 'packages/cli/src/commands/framework-development/runner-sync-admission.ts,tests/cli/runner-sync-build-actor-continuity.test.ts"',
  '--reason', 'trailing quote'
]);
assert.deepEqual(trailing.addPaths, quoted.addPaths);

const ticket = acquireWriteTicket({
  taskId: 'TASK-WRITE-0002',
  actorId: 'actor-a',
  files: ['packages/cli/src/commands/write-ticket.ts'],
  now: '2026-07-24T00:00:00.000Z'
});
const amendmentRequired = checkWriteTicket({
  ticket,
  taskId: 'TASK-WRITE-0002',
  actorId: 'actor-a',
  files: quoted.addPaths,
  observedPhase: 'pre-write',
  now: '2026-07-24T00:01:00.000Z'
});
assert.equal(amendmentRequired.code, 'ATM_WRITE_SCOPE_AMENDMENT_REQUIRED');
assert.equal(amendmentRequired.outOfScopeFiles.some((entry) => entry.startsWith('"')), false);
assert.equal(amendmentRequired.outOfScopeFiles.some((entry) => entry.endsWith('"')), false);

const auditedPaths = parseScopeAddCommandPaths('node atm.mjs tasks scope add --task TASK-WRITE-0002 --actor actor-a --add "packages/cli/src/commands/framework-development/runner-sync-admission.ts,tests/cli/runner-sync-build-actor-continuity.test.ts" --reason "linked surface" --json');
assert.deepEqual(auditedPaths, quoted.addPaths);
assert.equal(auditedPaths.some((entry) => entry.startsWith('"') || entry.endsWith('"')), false);

console.log('[write-ticket-scope-amendment.test] ok');
