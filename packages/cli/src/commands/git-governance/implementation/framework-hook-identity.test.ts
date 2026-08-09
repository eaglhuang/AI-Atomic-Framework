import assert from 'node:assert/strict';
import { resolveFrameworkHookTaskId } from './framework-hook-identity.ts';

assert.equal(
  resolveFrameworkHookTaskId({
    taskId: 'TASK-GOV-0001',
    frameworkClaimTaskId: 'ATM-FRAMEWORK-TEMP-agent-one-lane-lane-current',
    frameworkClaimCommitFiles: ['packages/core/src/example.ts']
  }),
  'TASK-GOV-0001',
  'a ledger task keeps precedence over framework-lock identity'
);
assert.equal(
  resolveFrameworkHookTaskId({
    taskId: null,
    frameworkClaimTaskId: 'ATM-FRAMEWORK-TEMP-agent-one-lane-lane-current',
    frameworkClaimCommitFiles: ['packages/core/src/example.ts']
  }),
  'ATM-FRAMEWORK-TEMP-agent-one-lane-lane-current',
  'a non-empty temporary framework claim yields its exact lock work-item identity'
);
assert.equal(
  resolveFrameworkHookTaskId({ taskId: null, frameworkClaimTaskId: 'ATM-FRAMEWORK-TEMP-agent-one-lane-lane-current', frameworkClaimCommitFiles: [] }),
  null,
  'an absent framework claim does not invent authority'
);
assert.equal(
  resolveFrameworkHookTaskId({ taskId: null, frameworkClaimTaskId: null, frameworkClaimCommitFiles: ['packages/core/src/example.ts'] }),
  null,
  'a non-empty surface without a verified lock identity fails closed'
);

console.log('framework-hook-identity: ok');
