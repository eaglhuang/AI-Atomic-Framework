import assert from 'node:assert/strict';
import {
  applyLegacyBcrMigration,
  buildLegacyBcrMigrationPlan,
  rollbackLegacyBcrMigration
} from '../../packages/cli/src/commands/broker/migrate/implementation.ts';
import { createBrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';

const records = [
  {
    id: 'canonical',
    conflictFiles: ['shared.ts'],
    brokerTicket: createBrokerTicket({ taskId: 'ATM-GOV-0233', actorId: 'captain', resourceKey: 'shared.ts' })
  }
];
const plan = buildLegacyBcrMigrationPlan({ records });
const receipt = applyLegacyBcrMigration({ records, plan });
const rollback = rollbackLegacyBcrMigration(receipt);

assert.equal(receipt.immutableRollbackReceipt.beforeDigest, receipt.beforeDigest);
assert.equal(rollback.ok, true);
assert.equal(rollback.restoredDigest, receipt.beforeDigest);
assert.equal(rollback.manualRuntimeEditsRequired, false);

console.log('[legacy-bcr-migration-rollback.test] ok');
