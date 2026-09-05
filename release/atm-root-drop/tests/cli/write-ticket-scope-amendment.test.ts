import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseScopeAddCommandPaths } from '../../packages/cli/src/commands/tasks/status-triangulation.ts';
import { readScopeAmendmentEvents } from '../../packages/cli/src/commands/tasks/status-triangulation.ts';
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

// Persisted transition events serialize the CSV as one quoted command argument.
// The closeback/status projection must consume the same normalized paths as the
// immediate scope-add response, rather than exposing shell quote artifacts.
{
  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-scope-amendment-history-'));
  const taskId = 'TASK-WRITE-0002';
  const eventDir = path.join(repo, '.atm', 'history', 'task-events', taskId);
  mkdirSync(eventDir, { recursive: true });
  writeFileSync(path.join(eventDir, '2026-09-05T00-00-00-000Z-scope-amendment.json'), `${JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    transitionId: 'transition-scope-amendment-1',
    taskId,
    actorId: 'actor-a',
    action: 'scope-amendment',
    command: 'node atm.mjs tasks scope add --task TASK-WRITE-0002 --actor actor-a --add "packages/cli/src/commands/framework-development/runner-sync-admission.ts,tests/cli/runner-sync-build-actor-continuity.test.ts" --json',
    amendmentMetadata: { amendmentMode: 'normal' }
  }, null, 2)}\n`, 'utf8');
  const persisted = readScopeAmendmentEvents(repo, taskId);
  assert.deepEqual(persisted[0]?.addedPaths, quoted.addPaths);
  assert.equal(persisted[0]?.addedPaths.some((entry) => entry.startsWith('"') || entry.endsWith('"')), false);
  console.log('Test G persisted scope amendment closeback projection: PASS');
}

console.log('[write-ticket-scope-amendment.test] ok');
