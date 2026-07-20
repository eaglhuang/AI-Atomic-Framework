import { decisionResultForStatus } from './match-and-sort.js';
export function ensureDecisionTrail(nextAction) {
    if (Array.isArray(nextAction.decisionTrail) && nextAction.decisionTrail.length > 0) {
        return nextAction;
    }
    nextAction.decisionTrail = buildDecisionTrail(nextAction);
    return nextAction;
}
export function buildDecisionTrail(nextAction) {
    const entries = [{
            check: 'route-status',
            result: decisionResultForStatus(nextAction.status),
            reason: nextAction.reason ?? `ATM selected route status ${nextAction.status}.`,
            ...(nextAction.command ? { nextCommand: nextAction.command } : {})
        }];
    const selectedTaskId = readTaskId(nextAction.selectedTask);
    if (selectedTaskId) {
        entries.push({
            check: 'task-selection',
            result: 'pass',
            reason: `Selected task ${selectedTaskId}.`
        });
    }
    else if (Array.isArray(nextAction.selectedTasks)) {
        entries.push({
            check: 'task-selection',
            result: nextAction.selectedTasks.length > 0 ? 'pass' : 'blocked',
            reason: `Selected ${nextAction.selectedTasks.length} task candidate(s).`
        });
    }
    if (nextAction.status === 'task-scope-not-found') {
        entries.push({
            check: 'prompt-scope-resolution',
            result: 'blocked',
            reason: 'No matching task scope was found; ATM did not fall back to unrelated task cards.'
        });
    }
    if (nextAction.status === 'task-no-work') {
        entries.push({
            check: 'prompt-scope-resolution',
            result: 'pass',
            reason: 'The scoped prompt resolved cleanly, but no open imported work remains for that scope.'
        });
    }
    if (nextAction.status === 'task-selection-required') {
        entries.push({
            check: 'prompt-scope-resolution',
            result: 'blocked',
            reason: 'Multiple task scopes matched; ATM requires a more specific prompt before routing.'
        });
    }
    if (nextAction.recommendedChannel) {
        entries.push({
            check: 'work-channel',
            result: 'info',
            reason: `Recommended ${nextAction.recommendedChannel} channel with ${nextAction.riskLevel ?? 'unknown'} risk.`
        });
    }
    const queueHeadTaskId = nextAction.queueHeadTaskId ?? readQueueHeadTaskId(nextAction.taskQueue);
    if (queueHeadTaskId) {
        entries.push({
            check: 'queue-head',
            result: 'pass',
            reason: `Current queue head is ${queueHeadTaskId}.`
        });
    }
    if (nextAction.taskDirectionLock?.schemaId === 'atm.taskDirectionLock.v1') {
        const taskId = nextAction.taskDirectionLock.taskId ?? selectedTaskId ?? queueHeadTaskId ?? '<task>';
        entries.push({
            check: 'task-direction-lock',
            result: 'pass',
            reason: `Task direction lock is active for ${taskId}.`,
            evidencePath: `.atm/runtime/locks/${taskId}.lock.json`
        });
    }
    if (Array.isArray(nextAction.missingEvidence) && nextAction.missingEvidence.length > 0) {
        entries.push({
            check: 'missing-evidence',
            result: 'blocked',
            reason: `Missing evidence: ${nextAction.missingEvidence.join(', ')}.`
        });
    }
    if (nextAction.closure?.closurePacketPath) {
        entries.push({
            check: 'closure-state',
            result: 'pass',
            reason: 'Task closure packet is available.',
            evidencePath: nextAction.closure.closurePacketPath
        });
    }
    if (Array.isArray(nextAction.allowedCommands) && nextAction.allowedCommands.length > 0) {
        entries.push({
            check: 'allowed-commands',
            result: 'info',
            reason: `${nextAction.allowedCommands.length} allowed command(s) are exposed for the route.`
        });
    }
    if (Array.isArray(nextAction.blockedCommands) && nextAction.blockedCommands.length > 0) {
        entries.push({
            check: 'blocked-commands',
            result: 'info',
            reason: `${nextAction.blockedCommands.length} blocked command pattern(s) are exposed for the route.`
        });
    }
    return entries;
}
export function readTaskId(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const candidate = value.workItemId;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}
export function readQueueHeadTaskId(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const candidate = value.queueHeadTaskId;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}
