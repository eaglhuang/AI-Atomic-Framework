import assert from 'node:assert/strict';
import {
  buildBatchDeliverAndCloseArgs,
  parseBatchDeliverAndCloseExtras,
  stripBatchDeliverAndCloseExtras
} from '../../packages/cli/src/commands/batch/deliver-and-close-forwarding.ts';
import { CliError } from '../../packages/cli/src/commands/shared.ts';

const argv = ['deliver-and-close', '--actor', 'captain', '--delivery-commit', 'abc123', '--emergency-approval', 'EMG-123', '--json'];
const extras = parseBatchDeliverAndCloseExtras(argv);
assert.deepEqual(extras, { deliveryCommit: 'abc123', deliveryMessage: null, reason: null, emergencyApproval: 'EMG-123' });
assert.deepEqual(stripBatchDeliverAndCloseExtras(argv), ['deliver-and-close', '--actor', 'captain', '--json']);
assert.deepEqual(
  buildBatchDeliverAndCloseArgs('C:/repo', 'TASK-1', 'captain', 'batch-1', extras),
  ['deliver-and-close', '--cwd', 'C:/repo', '--task', 'TASK-1', '--actor', 'captain', '--from-batch-checkpoint', '--batch', 'batch-1', '--json', '--delivery-commit', 'abc123', '--emergency-approval', 'EMG-123']
);

assert.throws(
  () => parseBatchDeliverAndCloseExtras(['deliver-and-close', '--emergency-approval']),
  (error: unknown) => error instanceof CliError && error.code === 'ATM_CLI_USAGE'
);

console.log('[batch-deliver-and-close-forwarding.test] ok');
