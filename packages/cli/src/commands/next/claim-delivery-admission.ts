import { classifyTaskDelivery } from '../task-intent.ts';
import { CliError, quoteCliValue } from '../shared.ts';

interface ClaimDeliveryTask {
  readonly workItemId: string;
  readonly status?: string | null;
  readonly targetRepo?: string | null;
  readonly closureAuthority?: string | null;
  readonly planningRepo?: string | null;
  readonly sourcePlanPath?: string | null;
  readonly taskPath?: string | null;
}

/** Reject planning mirrors before any claim, ticket, or direction lock write. */
export function assertClaimDeliveryAdmission(input: {
  readonly cwd: string;
  readonly task: ClaimDeliveryTask;
}): void {
  const classification = classifyTaskDelivery({
    cwd: input.cwd,
    task: {
      workItemId: input.task.workItemId,
      status: input.task.status,
      targetRepo: input.task.targetRepo,
      closureAuthority: input.task.closureAuthority,
      planningRepo: input.task.planningRepo,
      sourcePlanPath: input.task.sourcePlanPath,
      taskPath: input.task.taskPath
    }
  });
  if (classification.intent !== 'mirror-sync-only') return;
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
