import assert from 'node:assert/strict';
import { classifyBacklogDisposition } from '../../scripts/validate-backlog-census.ts';

assert.equal(classifyBacklogDisposition({ status: 'Fixed in ATM-GOV-0349', followUp: '' }).disposition, 'terminal');
assert.deepEqual(classifyBacklogDisposition({ status: 'Open', followUp: 'Owned by ATM-GOV-0340.' }), { disposition: 'deferred', ownerRefs: ['ATM-GOV-0340'] });
assert.equal(classifyBacklogDisposition({ status: 'Deferred', followUp: 'Owner-approved; tracked by TASK-ERR-0012.' }).disposition, 'deferred');
assert.equal(classifyBacklogDisposition({ status: 'Open', followUp: 'Investigate later.' }).disposition, 'deferred');
assert.equal(classifyBacklogDisposition({ status: 'Open', followUp: '' }).disposition, 'unclassified');
assert.equal(classifyBacklogDisposition({ status: 'Mystery', followUp: 'ATM-GOV-9999' }).disposition, 'unclassified');
console.log('[backlog-census-authority.test] ok');
