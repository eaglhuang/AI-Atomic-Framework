import assert from 'node:assert/strict';
import { resolveFrameworkHookTaskId } from './framework-hook-identity.ts';

assert.equal(
  resolveFrameworkHookTaskId({
    taskId: 'TASK-GOV-0001',
    actorId: 'agent-one',
    frameworkClaimCommitFiles: ['packages/core/src/example.ts']
  }),
  'TASK-GOV-0001',
  'a ledger task keeps precedence over framework-lock identity'
);
assert.equal(
  resolveFrameworkHookTaskId({
    taskId: null,
    actorId: 'agent one',
    frameworkClaimCommitFiles: ['packages/core/src/example.ts']
  }),
  'ATM-FRAMEWORK-TEMP-agent-one',
  'a non-empty temporary framework claim yields its stable work-item identity'
);
assert.equal(
  resolveFrameworkHookTaskId({ taskId: null, actorId: 'agent-one', frameworkClaimCommitFiles: [] }),
  null,
  'an absent framework claim does not invent authority'
);

console.log('framework-hook-identity: ok');
