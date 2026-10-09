import { makeResult, message, quoteCliValue, relativePathFrom } from '../../shared.js';
export function makeTasksClosedResult(input) {
    const { options, actorId } = input;
    // The transition is staged inside a close-commit window but not committed.
    // Left staged, the terminal task's ledger reads as a cross-task mutation and
    // `next` enters incident-safe mode, so name the commit that lands it.
    const nextCommand = input.closeCommitWindowPathFromClose
        ? `node atm.mjs git commit --actor ${quoteCliValue(actorId)} --task ${options.taskId} --message ${quoteCliValue(`chore: ${options.status} ${options.taskId}`)} --json`
        : null;
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [message('info', 'ATM_TASKS_CLOSED', `Task ${options.taskId} moved to ${options.status}.`, {
                taskId: options.taskId,
                actorId,
                status: options.status,
                closeCommitWindowPath: input.closeCommitWindowPathFromClose,
                ...(nextCommand ? { requiredCommand: nextCommand } : {})
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
            nextCommand,
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
