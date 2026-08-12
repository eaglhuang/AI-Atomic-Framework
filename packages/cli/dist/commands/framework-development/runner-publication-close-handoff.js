import { validateRunnerBuildOutputInventory } from '../../../../core/dist/broker/runner-build-output-inventory.js';
/** Converts a sealed receipt into an exact, task-owned close bundle. */
export function resolveRunnerPublicationCloseHandoff(input) {
    if (!input.receipt || input.receipt.schemaId !== 'atm.runnerSyncReceipt.v1') {
        return { ok: false, stageFiles: [], reason: 'runner-sync receipt is missing or has an invalid schema' };
    }
    if (String(input.receipt.taskId ?? '').trim() !== input.taskId) {
        return { ok: false, stageFiles: [], reason: 'runner-sync receipt task attribution does not match the closing task' };
    }
    const validated = validateRunnerBuildOutputInventory(input.receipt.outputInventory);
    if (!validated.ok || !validated.inventory) {
        return { ok: false, stageFiles: [], reason: 'runner-sync receipt output inventory is invalid' };
    }
    const foreign = validated.inventory.entries.filter((entry) => entry.disposition !== 'owned-current' || entry.ownerTaskId !== input.taskId);
    if (foreign.length > 0) {
        return { ok: false, stageFiles: [], reason: 'runner-sync receipt inventory contains output not owned by the closing task' };
    }
    return {
        ok: true,
        stageFiles: [...new Set(validated.inventory.entries.map((entry) => entry.path))].sort((a, b) => a.localeCompare(b)),
        reason: null
    };
}
/**
 * Authorizes a close commit only when its framework-critical outputs are the
 * exact task-owned inventory sealed by the runner-publication receipt.
 */
export function authorizesRunnerPublicationCloseCommit(input) {
    const handoff = resolveRunnerPublicationCloseHandoff({ taskId: input.taskId, receipt: input.receipt });
    if (!handoff.ok)
        return false;
    const ownedFiles = new Set(handoff.stageFiles);
    return input.criticalChangedFiles.length > 0
        && input.criticalChangedFiles.every((file) => ownedFiles.has(file));
}
