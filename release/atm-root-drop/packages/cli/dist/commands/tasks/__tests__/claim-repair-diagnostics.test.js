import { buildRepairClaimCommand } from '../claim-repair-diagnostics.js';
import { createClaimRecord } from '../task-ledger-readers.js';
function fail(message) {
    console.error(`[claim-repair-diagnostics.test] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
assert(buildRepairClaimCommand({ taskId: 'TASK-MAO-0043', actorId: 'cursor-gpt-5.2', write: true, reason: 'stale drift' }).includes('--write'), 'repair claim command must include --write');
const expiredClaim = {
    ...createClaimRecord({
        taskId: 'TASK-UNIT-0043',
        actorId: 'stale-worker',
        files: ['packages/cli/src/commands/tasks.ts'],
        ttlSeconds: 1,
        timestamp: new Date(Date.now() - 120_000).toISOString()
    }),
    state: 'active'
};
assert(expiredClaim.leaseId.startsWith('lease-'), 'claim fixture must have lease id');
assert(typeof expiredClaim.actorId === 'string', 'claim fixture must retain actor id');
console.log('[claim-repair-diagnostics.test] ok');
