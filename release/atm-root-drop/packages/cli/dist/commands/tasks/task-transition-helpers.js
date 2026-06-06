/**
 * task-transition-helpers.ts
 *
 * Task transition / status helpers extracted from tasks.ts.
 * Fully self-contained to avoid circular dependency with tasks.ts.
 */
import { CliError } from '../shared.js';
import { readTaskLedgerPolicy } from '../task-ledger.js';
const validStatuses = new Set(['planned', 'open', 'in_progress', 'reserved', 'ready', 'running', 'review', 'blocked', 'abandoned', 'done']);
function normalizeTaskStatus(value) {
    return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}
function quoteCommandValue(value) {
    return /^[A-Za-z0-9._:/\\-]+$/.test(value)
        ? value
        : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
/**
 * Asserts local task ledger policy is enabled.
 */
export function assertLocalTaskLedgerEnabled(cwd, action) {
    const taskLedger = readTaskLedgerPolicy(cwd);
    if (!taskLedger.enabled) {
        throw new CliError('ATM_TASK_LEDGER_DISABLED', `tasks ${action} cannot write local task files because taskLedger.enabled is false.`, {
            exitCode: 1,
            details: {
                action,
                provider: taskLedger.provider,
                taskRoot: taskLedger.taskRoot
            }
        });
    }
}
/**
 * Builds standard transition command strings consistently.
 */
export function buildTaskTransitionCommand(input) {
    const parts = ['node', 'atm.mjs', 'tasks', input.action];
    if (input.taskId) {
        parts.push('--task', quoteCommandValue(input.taskId));
    }
    if (input.actorId) {
        parts.push('--actor', quoteCommandValue(input.actorId));
    }
    if (input.status) {
        parts.push('--status', quoteCommandValue(input.status));
    }
    if (input.fromBatchCheckpoint) {
        parts.push('--from-batch-checkpoint');
    }
    if (input.batchId) {
        parts.push('--batch', quoteCommandValue(input.batchId));
    }
    for (const ref of input.historicalDeliveryRefs ?? []) {
        parts.push('--historical-delivery', quoteCommandValue(ref));
    }
    return parts.join(' ');
}
/**
 * Packs metadata for task closure transitions.
 */
export function createClosureTransitionMetadata(closurePacketPath, closurePacket, batchId = null, sessionId = null) {
    if (!closurePacket && !closurePacketPath && !batchId && !sessionId) {
        return null;
    }
    return {
        schemaId: 'atm.taskClosureTransition.v1',
        batchId,
        sessionId,
        closurePacketPath,
        evidenceFreshness: closurePacket?.evidenceFreshness ?? null,
        validationPasses: closurePacket?.validationPasses ?? [],
        requiredGates: closurePacket?.requiredGates ?? [],
        requiredGatesSnapshot: closurePacket?.requiredGatesSnapshot
            ? {
                schemaId: closurePacket.requiredGatesSnapshot.schemaId,
                generatedAt: closurePacket.requiredGatesSnapshot.generatedAt,
                source: closurePacket.requiredGatesSnapshot.source,
                ruleVersion: closurePacket.requiredGatesSnapshot.ruleVersion,
                frameworkMode: closurePacket.requiredGatesSnapshot.frameworkMode,
                repoRole: closurePacket.requiredGatesSnapshot.repoRole,
                changedFiles: [...closurePacket.requiredGatesSnapshot.changedFiles],
                criticalChangedFiles: [...closurePacket.requiredGatesSnapshot.criticalChangedFiles],
                requiredGates: [...closurePacket.requiredGatesSnapshot.requiredGates]
            }
            : null
    };
}
/**
 * Normalizes work item statuses securely.
 */
export function normalizeWorkItemStatus(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'planned'
        || normalized === 'reserved'
        || normalized === 'ready'
        || normalized === 'locked'
        || normalized === 'running'
        || normalized === 'review'
        || normalized === 'verified'
        || normalized === 'done'
        || normalized === 'blocked'
        || normalized === 'abandoned') {
        return normalized;
    }
    if (normalized === 'open' || normalized === 'in_progress') {
        return 'ready';
    }
    return 'planned';
}
/**
 * Inspects verify status with aliases check.
 */
export function inspectTaskVerifyStatus(value) {
    const normalized = normalizeTaskStatus(value);
    if (validStatuses.has(normalized)) {
        return {
            ok: true,
            normalizedStatus: normalized,
            warningCode: null
        };
    }
    if (normalized === 'closed' || normalized === 'completed') {
        return {
            ok: true,
            normalizedStatus: 'done',
            warningCode: 'ATM_TASKS_VERIFY_LEGACY_STATUS_ALIAS'
        };
    }
    return {
        ok: false,
        normalizedStatus: null,
        warningCode: null
    };
}
