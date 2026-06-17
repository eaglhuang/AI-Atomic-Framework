import {
  applyClaimRepairWrite,
  buildRepairClaimCommand,
  diagnoseClaimRepairState
} from '../claim-repair-diagnostics.ts';
import { createClaimRecord } from '../task-ledger-readers.ts';

function fail(message: string): never {
  console.error(`[claim-repair-diagnostics.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

assert(
  buildRepairClaimCommand({ taskId: 'TASK-MAO-0043', actorId: 'cursor-gpt-5.2', write: true, reason: 'stale drift' }).includes('--write'),
  'repair claim command must include --write'
);

const expiredClaim = {
  ...createClaimRecord({
    taskId: 'TASK-UNIT-0043',
    actorId: 'stale-worker',
    files: ['packages/cli/src/commands/tasks.ts'],
    ttlSeconds: 1,
    timestamp: new Date(Date.now() - 120_000).toISOString()
  }),
  state: 'active' as const
};

assert(expiredClaim.leaseId.startsWith('lease-'), 'claim fixture must have lease id');
assert(typeof expiredClaim.actorId === 'string', 'claim fixture must retain actor id');

console.log('[claim-repair-diagnostics.test] ok');
