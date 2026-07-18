import { makeResult, message, relativePathFrom } from '../../shared.js';
export function makeTasksClosedResult(input) {
    const { options, actorId } = input;
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [message('info', 'ATM_TASKS_CLOSED', `Task ${options.taskId} moved to ${options.status}.`, {
                taskId: options.taskId,
                actorId,
                status: options.status,
                closeCommitWindowPath: input.closeCommitWindowPathFromClose
            })],
        evidence: {
            action: 'close',
            taskId: options.taskId,
            actorId,
            status: options.status,
            taskPath: relativePathFrom(options.cwd, input.taskPath),
            evidenceGate: input.evidenceGate,
            closurePacketPath: input.closurePacketPath,
            transitionPath: input.transitionPath,
            closeCommitWindowPath: input.closeCommitWindowPathFromClose,
            closeCommitWindowAllowedFiles: input.closeArtifactFiles,
            deliverableGate: input.deliverableGate,
            cleanedTeamRuns: input.cleanedTeamRuns,
            closeScopedDiffIsolation: input.closeScopedDiffIsolation,
            emergencyUse: input.emergencyUse,
            protectedOverrideOutcome: input.protectedOverrideOutcome,
            failedEmergencyAuditPath: input.failedEmergencyAuditPath,
            taskQueue: input.taskQueue,
            historicalBatchSlice: input.historicalBatchSlice
        }
    });
}
