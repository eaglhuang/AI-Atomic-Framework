import assert from 'node:assert/strict';
import { buildLegacyBcrMigrationPlan, applyLegacyBcrMigration } from '../../packages/cli/src/commands/broker/migrate/implementation.ts';
import { createBrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';

const ticket = createBrokerTicket({ taskId: 'ATM-GOV-0233', actorId: 'captain', resourceKey: 'shared.ts' });
const plan = buildLegacyBcrMigrationPlan({
  records: [
    { id: 'canonical', conflictFiles: ['shared.ts'], brokerTicket: ticket },
    { id: 'legacy-only', conflictFiles: ['shared.ts'], conflictTaskId: 'FOREIGN' },
    { id: 'legacy-auth', conflictFiles: ['shared.ts'], legacyAuthorizedTaskIds: ['FOREIGN'], brokerTicket: ticket }
  ]
});

assert.equal(plan.migratedCount, 1);
assert.equal(plan.quarantinedCount, 2);
assert.equal(plan.legacyAuthorizationUseCount, 1);
assert.equal(plan.entries.find((entry) => entry.id === 'legacy-only')?.code, 'ATM_TICKET_ADOPT_REQUIRED');
assert.equal(plan.entries.find((entry) => entry.id === 'legacy-auth')?.code, 'ATM_BROKER_AUTHORIZATION_DIMENSION_MISMATCH');

const receipt = applyLegacyBcrMigration({ records: [], plan });
assert.equal(receipt.manualRuntimeEditsRequired, false);
assert.deepEqual(receipt.immutableRollbackReceipt.migratedEntryIds, ['canonical']);
assert.deepEqual(receipt.immutableRollbackReceipt.quarantinedEntryIds, ['legacy-only', 'legacy-auth']);

console.log('[legacy-bcr-migration.test] ok');
