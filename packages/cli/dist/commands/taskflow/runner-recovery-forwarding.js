export const TASKFLOW_RUNNER_RECOVERY_DECISION_SCHEMA_ID = 'atm.taskflowRunnerRecoveryDecision.v1';
function normalizeLeaseId(emergencyApproval) {
    const leaseId = typeof emergencyApproval === 'string' ? emergencyApproval.trim() : '';
    return leaseId.length > 0 ? leaseId : null;
}
function shaEquals(left, right) {
    const sealed = typeof left === 'string' ? left.trim() : '';
    const head = typeof right === 'string' ? right.trim() : '';
    return sealed.length > 0 && head.length > 0 && sealed === head;
}
export function decideTaskflowRunnerRecovery(input) {
    const publicationAccepted = input.runnerPublicationAccepted === true;
    const emergencyLeaseId = normalizeLeaseId(input.emergencyApproval);
    const shaProvided = Boolean((typeof input.sealedSourceSha === 'string' && input.sealedSourceSha.trim())
        && (typeof input.currentHead === 'string' && input.currentHead.trim()));
    const frozenShaEqualsHead = shaProvided
        ? shaEquals(input.sealedSourceSha, input.currentHead)
        : publicationAccepted;
    const runnerSyncRequired = input.runnerSyncRequired === true;
    const recoveryRequired = !(publicationAccepted && frozenShaEqualsHead);
    const forwardAllowStaleRunner = recoveryRequired && emergencyLeaseId !== null;
    const forwardEmergencyApproval = forwardAllowStaleRunner;
    const blocksDryRun = recoveryRequired && (runnerSyncRequired || shaProvided) && emergencyLeaseId === null;
    const reason = !recoveryRequired
        ? 'Accepted runner publication matches HEAD; close must not use stale-runner emergency arguments.'
        : forwardAllowStaleRunner
            ? 'Recovery is required and a human-approved lease authorizes stale-runner forwarding.'
            : 'Recovery is required; fail closed without forwarding --allow-stale-runner or requiring a lease on a normal close.';
    return {
        schemaId: TASKFLOW_RUNNER_RECOVERY_DECISION_SCHEMA_ID,
        publicationAccepted,
        frozenShaEqualsHead,
        runnerSyncRequired,
        emergencyLeaseId,
        recoveryRequired,
        forwardAllowStaleRunner,
        forwardEmergencyApproval,
        blocksDryRun,
        reason
    };
}
function isRunnerRecoveryDecision(input) {
    return 'schemaId' in input && input.schemaId === TASKFLOW_RUNNER_RECOVERY_DECISION_SCHEMA_ID;
}
export function buildTaskflowRunnerRecoveryArgs(input) {
    const decision = isRunnerRecoveryDecision(input) ? input : decideTaskflowRunnerRecovery(input);
    if (!decision.forwardAllowStaleRunner)
        return [];
    return [
        ...(decision.forwardEmergencyApproval && decision.emergencyLeaseId
            ? ['--emergency-approval', decision.emergencyLeaseId]
            : []),
        '--allow-stale-runner'
    ];
}
