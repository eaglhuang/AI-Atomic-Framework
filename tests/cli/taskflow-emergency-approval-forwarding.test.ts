import assert from 'node:assert/strict';
import { buildTaskflowRunnerRecoveryArgs } from '../../packages/cli/src/commands/taskflow/runner-recovery-forwarding.ts';
import taskflowSpec from '../../packages/cli/src/commands/command-specs/taskflow.spec.ts';

assert.deepEqual(
  buildTaskflowRunnerRecoveryArgs({ runnerPublicationAccepted: true, emergencyApproval: ' EMG-0359 ' }),
  ['--emergency-approval', 'EMG-0359', '--allow-stale-runner']
);

assert.deepEqual(
  buildTaskflowRunnerRecoveryArgs({ runnerPublicationAccepted: true, emergencyApproval: null }),
  ['--allow-stale-runner'],
  'missing approval must still reach the backend gate and fail closed there'
);

assert.deepEqual(
  buildTaskflowRunnerRecoveryArgs({ runnerPublicationAccepted: false, emergencyApproval: 'EMG-UNUSED' }),
  ['--emergency-approval', 'EMG-UNUSED', '--allow-stale-runner'],
  'an explicit recovery lease is canonical authority even when the publication receipt is unavailable'
);

assert.ok(
  (taskflowSpec.options ?? []).some((option) => option.flag === '--emergency-approval'),
  'the public taskflow command must advertise the recovery lease it can forward'
);

console.log('[taskflow-emergency-approval-forwarding] ok');
