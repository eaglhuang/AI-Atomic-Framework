import { validateRunnerBuildOutputInventory } from '../../../../core/src/broker/runner-build-output-inventory.ts';

export interface RunnerPublicationCloseHandoff {
  readonly ok: boolean;
  readonly stageFiles: readonly string[];
  readonly reason: string | null;
}

function normalizedStringSet(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

/**
 * A durable receipt may be owned by the delivery task while its sealed build
 * outputs are attributed to its coalesced framework-temp producer(s).  The
 * receipt is the authority after publication; a live lease is deliberately
 * not, because it may correctly have been released before closeout.
 */
function resolveAuthorizedProducerTaskIds(input: {
  readonly closingTaskId: string;
  readonly receipt: Record<string, unknown>;
}): { readonly producerTaskIds: readonly string[]; readonly reason: string | null } {
  const linkedTaskIds = normalizedStringSet(input.receipt.linkedTaskIds);
  const memberTaskIds = normalizedStringSet(input.receipt.memberTaskIds);
  if (memberTaskIds.length === 0) {
    return { producerTaskIds: [], reason: 'runner-sync receipt has no producer member attribution' };
  }
  const receiptTaskId = typeof input.receipt.taskId === 'string' ? input.receipt.taskId.trim() : '';
  const directOwner = receiptTaskId === input.closingTaskId && memberTaskIds.includes(input.closingTaskId);
  if (!directOwner && !linkedTaskIds.includes(input.closingTaskId)) {
    return { producerTaskIds: [], reason: 'runner-sync receipt does not durably link this closing task to its producer group' };
  }
  const groupManifest = input.receipt.groupManifest;
  const groupMembers = groupManifest && typeof groupManifest === 'object' && !Array.isArray(groupManifest)
    ? normalizedStringSet((groupManifest as Record<string, unknown>).memberTaskIds)
    : [];
  if (!sameStringSet(memberTaskIds, groupMembers)) {
    return { producerTaskIds: [], reason: 'runner-sync receipt producer group attribution is missing or inconsistent' };
  }
  const childAttribution = input.receipt.childAttribution;
  const attributedMembers = childAttribution && typeof childAttribution === 'object' && !Array.isArray(childAttribution)
    ? normalizedStringSet(((childAttribution as Record<string, unknown>).members as unknown[] | undefined)?.map((entry) => (
      entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>).taskId : null
    )))
    : [];
  const attributionComplete = childAttribution && typeof childAttribution === 'object' && !Array.isArray(childAttribution)
    && (childAttribution as Record<string, unknown>).complete === true;
  if (!attributionComplete || !sameStringSet(memberTaskIds, attributedMembers)) {
    return { producerTaskIds: [], reason: 'runner-sync receipt child attribution is incomplete or inconsistent' };
  }
  return { producerTaskIds: memberTaskIds, reason: null };
}

/** Converts a sealed receipt into an exact, task-owned close bundle. */
export function resolveRunnerPublicationCloseHandoff(input: {
  readonly taskId: string;
  readonly receipt: Record<string, unknown> | null;
}): RunnerPublicationCloseHandoff {
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
  const producers = resolveAuthorizedProducerTaskIds({ closingTaskId: input.taskId, receipt: input.receipt });
  if (producers.reason) {
    return { ok: false, stageFiles: [], reason: producers.reason };
  }
  const authorizedOwners = new Set([input.taskId, ...producers.producerTaskIds]);
  const foreign = validated.inventory.entries.filter((entry) => entry.disposition !== 'owned-current' || !entry.ownerTaskId || !authorizedOwners.has(entry.ownerTaskId));
  if (foreign.length > 0) {
    return { ok: false, stageFiles: [], reason: 'runner-sync receipt inventory contains output not owned by the closing task or its attested producer group' };
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
export function authorizesRunnerPublicationCloseCommit(input: {
  readonly taskId: string;
  readonly receipt: Record<string, unknown> | null;
  readonly criticalChangedFiles: readonly string[];
}): boolean {
  const handoff = resolveRunnerPublicationCloseHandoff({ taskId: input.taskId, receipt: input.receipt });
  if (!handoff.ok) return false;
  const ownedFiles = new Set(handoff.stageFiles);
  return input.criticalChangedFiles.length > 0
    && input.criticalChangedFiles.every((file) => ownedFiles.has(file));
}
