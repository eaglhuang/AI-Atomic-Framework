import assert from 'node:assert/strict';
import { listTaskLedgerInvariantIds, taskLedgerInvariantRegistry } from '../../../lib/task-ledger-invariant-registry.ts';

assert.equal(taskLedgerInvariantRegistry.length, 13);
const ids = listTaskLedgerInvariantIds();
assert.equal(ids.length, 13);
assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));

for (const entry of taskLedgerInvariantRegistry) {
  assert.equal(typeof entry.id, 'string');
  assert.equal(typeof entry.description, 'string');
  assert.equal(typeof entry.run, 'function');
}

console.log('[registry.spec] ok');
