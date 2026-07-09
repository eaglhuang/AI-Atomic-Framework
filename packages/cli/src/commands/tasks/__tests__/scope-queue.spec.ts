import assert from 'node:assert/strict';
import { scopeQueueAtomBoundary } from '../scope-queue.ts';

assert.equal(scopeQueueAtomBoundary.owner, 'atm.tasks-command.scope-queue');
assert.ok(scopeQueueAtomBoundary.commands.includes('tasks scope add'));
assert.ok(scopeQueueAtomBoundary.commands.includes('tasks queue status'));
assert.ok(scopeQueueAtomBoundary.commands.includes('tasks parallel'));
assert.ok(scopeQueueAtomBoundary.commands.includes('tasks lock cleanup'));

console.log('scope-queue.spec passed');
