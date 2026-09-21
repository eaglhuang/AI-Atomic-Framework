import { classifyTaskDelivery } from '../task-intent.js';
import { CliError, quoteCliValue } from '../shared.js';
/** Reject planning mirrors before any claim, ticket, or direction lock write. */
export function assertClaimDeliveryAdmission(input) {
    const classification = classifyTaskDelivery({
        cwd: input.cwd,
        task: {
            workItemId: input.task.workItemId,
            status: input.task.status ?? 'unknown',
            targetRepo: input.task.targetRepo ?? null,
            closureAuthority: input.task.closureAuthority ?? null,
            planningRepo: input.task.planningRepo ?? null,
            sourcePlanPath: input.task.sourcePlanPath ?? null,
            taskPath: input.task.taskPath ?? input.task.sourcePlanPath ?? input.task.workItemId
        }
    });
    if (classification.intent !== 'mirror-sync-only')
        return;
    const sourcePath = input.task.sourcePlanPath ?? '<source-task-card-path>';
    const requiredCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --write --force --json`;
    throw new CliError('ATM_NEXT_CLAIM_MIRROR_SYNC_REQUIRED', `Task ${input.task.workItemId} is a planning-only mirror in this repo; sync the ledger from the source task card instead of claiming a delivery.`, {
        exitCode: 1,
        details: {
            taskId: input.task.workItemId,
            targetRepo: classification.targetRepo,
            closureAuthority: classification.closureAuthority,
            planningRepo: classification.planningRepo,
            sourceStatus: classification.sourceStatus,
            ledgerStatus: classification.ledgerStatus,
            statusDivergence: classification.statusDivergence,
            requiredCommand,
            deliveryClassification: classification
        }
    });
}
