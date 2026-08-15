import assert from 'node:assert/strict';
import {
  buildTaskflowRunnerRecoveryArgs,
  decideTaskflowRunnerRecovery
} from '../../packages/cli/src/commands/taskflow/runner-recovery-forwarding.ts';
import taskflowSpec from '../../packages/cli/src/commands/command-specs/taskflow.spec.ts';

const GOV_0370_SEALED_SHA = '2bbce6c359462c4a812cde1a47bd10704674defb';

function assertNoStaleRunnerArgs(args: readonly string[], message: string): void {
  assert.equal(args.includes('--allow-stale-runner'), false, message);
  assert.equal(args.includes('--emergency-approval'), false, message);
}

{
  const decision = decideTaskflowRunnerRecovery({
    runnerPublicationAccepted: true,
    sealedSourceSha: GOV_0370_SEALED_SHA,
    currentHead: GOV_0370_SEALED_SHA,
    emergencyApproval: ' EMG-0359 ',
    runnerSyncRequired: true
  });
  assert.equal(decision.recoveryRequired, false);
  assert.equal(decision.blocksDryRun, false);
  assert.deepEqual(
    buildTaskflowRunnerRecoveryArgs(decision),
    [],
    'accepted publication matching HEAD must not forward a lease or --allow-stale-runner'
  );
}

{
  const decision = decideTaskflowRunnerRecovery({
    runnerPublicationAccepted: true,
    sealedSourceSha: GOV_0370_SEALED_SHA,
    currentHead: GOV_0370_SEALED_SHA,
    emergencyApproval: null,
    runnerSyncRequired: true
  });
  assert.equal(decision.schemaId, 'atm.taskflowRunnerRecoveryDecision.v1');
  assert.equal(decision.blocksDryRun, false);
  assertNoStaleRunnerArgs(
    buildTaskflowRunnerRecoveryArgs(decision),
    'accepted_publication_matching_head_forwards_no_stale_runner_args_0396'
  );
}

{
  const observedGov0370WriteForwardedArgs = ['--allow-stale-runner'];
  const decision = decideTaskflowRunnerRecovery({
    runnerPublicationAccepted: true,
    sealedSourceSha: GOV_0370_SEALED_SHA,
    currentHead: GOV_0370_SEALED_SHA,
    emergencyApproval: null,
    runnerSyncRequired: false
  });
  assert.equal(decision.blocksDryRun, false, 'dry_run_and_write_share_normalized_runner_recovery_decision_0396 dry-run');
  const forwarded = buildTaskflowRunnerRecoveryArgs(decision);
  assert.notDeepEqual(
    forwarded,
    observedGov0370WriteForwardedArgs,
    'the saved 0370 write JSON forwarded --allow-stale-runner after a ready dry-run; that split is the defect'
  );
  assert.deepEqual(forwarded, []);
  assert.equal(decision.forwardAllowStaleRunner, decision.blocksDryRun);
}

{
  const unaccepted = decideTaskflowRunnerRecovery({
    runnerPublicationAccepted: false,
    sealedSourceSha: GOV_0370_SEALED_SHA,
    currentHead: 'ffffffffffffffffffffffffffffffffffffffff',
    emergencyApproval: null,
    runnerSyncRequired: true
  });
  assert.equal(unaccepted.recoveryRequired, true);
  assert.equal(unaccepted.blocksDryRun, true);
  assert.deepEqual(
    buildTaskflowRunnerRecoveryArgs(unaccepted),
    [],
    'unaccepted_or_mismatched_receipt_keeps_fail_closed_recovery_0396: no lease must not forward the protected flag'
  );

  const leased = decideTaskflowRunnerRecovery({
    runnerPublicationAccepted: false,
    emergencyApproval: 'EMG-UNUSED',
    runnerSyncRequired: true
  });
  assert.deepEqual(
    buildTaskflowRunnerRecoveryArgs(leased),
    ['--emergency-approval', 'EMG-UNUSED', '--allow-stale-runner'],
    'an explicit recovery lease remains canonical authority when publication is not accepted'
  );

  const mismatchedAccepted = decideTaskflowRunnerRecovery({
    runnerPublicationAccepted: true,
    sealedSourceSha: GOV_0370_SEALED_SHA,
    currentHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    emergencyApproval: 'EMG-SHA',
    runnerSyncRequired: false
  });
  assert.equal(mismatchedAccepted.frozenShaEqualsHead, false);
  assert.deepEqual(
    buildTaskflowRunnerRecoveryArgs(mismatchedAccepted),
    ['--emergency-approval', 'EMG-SHA', '--allow-stale-runner']
  );
}

assert.deepEqual(
  buildTaskflowRunnerRecoveryArgs({ runnerPublicationAccepted: true, emergencyApproval: null }),
  [],
  'legacy write call site: accepted publication forwards no stale-runner args'
);

assert.deepEqual(
  buildTaskflowRunnerRecoveryArgs({ runnerPublicationAccepted: false, emergencyApproval: 'EMG-UNUSED' }),
  ['--emergency-approval', 'EMG-UNUSED', '--allow-stale-runner']
);

assert.ok(
  (taskflowSpec.options ?? []).some((option) => option.flag === '--emergency-approval'),
  'the public taskflow command must advertise the recovery lease it can forward'
);

console.log('[taskflow-emergency-approval-forwarding] ok');
