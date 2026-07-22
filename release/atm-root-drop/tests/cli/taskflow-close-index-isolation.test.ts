import assert from 'node:assert/strict';
import { buildTaskflowCloseIndexIsolationReceipt } from '../../packages/core/src/broker/lifecycle/index.ts';

const receipt = buildTaskflowCloseIndexIsolationReceipt({
  closeScopedEntries: ['.atm/history/tasks/ATM-GOV-0233.json'],
  foreignStagedEntries: ['packages/other-agent/work.ts']
});

assert.equal(receipt.ok, true);
assert.deepEqual(receipt.parkedForeignEntries, ['packages/other-agent/work.ts']);
assert.deepEqual(receipt.restoredForeignEntries, ['packages/other-agent/work.ts']);
assert.equal(receipt.restoreContract, 'immutable-receipt-required');
assert.notEqual(receipt.beforeDigest, receipt.afterDigest);

console.log('[taskflow-close-index-isolation.test] ok');
