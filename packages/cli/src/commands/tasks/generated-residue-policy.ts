import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type GeneratedResidueLifecycleAction = 'release' | 'abandon' | null;

export interface GeneratedResidueTaskDisposition {
  readonly status: string | null;
  readonly claimState: string | null;
  readonly lastLifecycleAction: GeneratedResidueLifecycleAction;
  readonly hasActiveClaim: boolean;
}

export interface ReleasedResidueTransactionPlan {
  readonly schemaId: 'atm.releasedResidueTransactionPlan.v1';
  readonly candidateTaskId: string;
  readonly ownerTaskIds: readonly string[];
  readonly disposition: 'park-and-restore' | 'not-eligible';
  readonly reason: string;
}

export interface ReleasedResidueOwnerPartition {
  readonly candidateTaskId: string;
  readonly ownerTaskIds: readonly string[];
  readonly safeOwnerTaskIds: readonly string[];
  readonly blockedOwnerTaskIds: readonly string[];
}

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalize(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function latestLifecycleAction(cwd: string, taskId: string): GeneratedResidueLifecycleAction {
  const directory = path.join(cwd, '.atm', 'history', 'task-events', taskId);
  if (!existsSync(directory)) return null;
  const candidates = readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const event = readJson(path.join(directory, entry));
      const action = normalize(event?.action ?? event?.eventType ?? event?.transition);
      if (action !== 'release' && action !== 'abandon') return null;
      const timestamp = String(event?.createdAt ?? event?.timestamp ?? event?.at ?? '');
      return { action, timestamp };
    })
    .filter((entry): entry is { action: 'release' | 'abandon'; timestamp: string } => Boolean(entry))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  return candidates[0]?.action ?? null;
}

export function readGeneratedResidueTaskDisposition(cwd: string, taskId: string): GeneratedResidueTaskDisposition | null {
  if (!cwd || !taskId) return null;
  const normalizedTaskId = taskId.trim().toUpperCase();
  const ledger = readJson(path.join(cwd, '.atm', 'history', 'tasks', `${normalizedTaskId}.json`));
  if (!ledger) return null;
  const claim = ledger.claim && typeof ledger.claim === 'object' && !Array.isArray(ledger.claim)
    ? ledger.claim as Record<string, unknown>
    : null;
  const claimState = normalize(claim?.state);
  return {
    status: normalize(ledger.status),
    claimState,
    lastLifecycleAction: latestLifecycleAction(cwd, normalizedTaskId),
    hasActiveClaim: claimState === 'active' || claimState === 'claimed' || Boolean(claim?.owner),
  };
}

export function isReleasedGeneratedBundleSafeToClean(
  disposition: GeneratedResidueTaskDisposition | null,
): boolean {
  if (!disposition || disposition.hasActiveClaim) return false;
  const terminalStatus = disposition.status === 'done' || disposition.status === 'abandoned';
  const releasedLifecycle = disposition.lastLifecycleAction === 'release' || disposition.lastLifecycleAction === 'abandon';
  return (terminalStatus || releasedLifecycle) && disposition.status !== 'running' && disposition.status !== 'review';
}

/**
 * Decides whether a foreign staged governance bundle can be isolated by the
 * standard index park/restore transaction. This preserves every staged blob;
 * it never authorizes deletion or inclusion in the candidate task's commit.
 */
export function planReleasedResidueTransaction(input: {
  readonly cwd: string;
  readonly candidateTaskId: string;
  readonly ownerTaskIds: readonly string[];
}): ReleasedResidueTransactionPlan {
  const partition = partitionReleasedResidueOwners(input);
  const eligible = partition.ownerTaskIds.length > 0 && partition.blockedOwnerTaskIds.length === 0;
  return {
    schemaId: 'atm.releasedResidueTransactionPlan.v1',
    candidateTaskId: partition.candidateTaskId,
    ownerTaskIds: partition.ownerTaskIds,
    disposition: eligible ? 'park-and-restore' : 'not-eligible',
    reason: eligible
      ? 'Every foreign owner has a released or abandoned lifecycle disposition with no active claim; preserve staged blobs through the standard park/restore transaction.'
      : 'At least one foreign owner is active, unresolved, or lacks a released lifecycle disposition; broker or explicit override authority remains required.'
  };
}

export function partitionReleasedResidueOwners(input: {
  readonly cwd: string;
  readonly candidateTaskId: string;
  readonly ownerTaskIds: readonly string[];
}): ReleasedResidueOwnerPartition {
  const candidateTaskId = String(input.candidateTaskId ?? '').trim().toUpperCase();
  const ownerTaskIds = [...new Set(input.ownerTaskIds
    .map((taskId) => String(taskId ?? '').trim().toUpperCase())
    .filter((taskId) => taskId && taskId !== candidateTaskId))]
    .sort((left, right) => left.localeCompare(right));
  const safeOwnerTaskIds = ownerTaskIds.filter((taskId) =>
    isReleasedGeneratedBundleSafeToClean(readGeneratedResidueTaskDisposition(input.cwd, taskId)));
  const safeOwnerTaskIdSet = new Set(safeOwnerTaskIds);
  return {
    candidateTaskId,
    ownerTaskIds,
    safeOwnerTaskIds,
    blockedOwnerTaskIds: ownerTaskIds.filter((taskId) => !safeOwnerTaskIdSet.has(taskId)),
  };
}

/**
 * Applies the one lifecycle-derived park/restore decision to every hook or
 * commit caller that classifies generated residue.  Callers retain ownership
 * of residue discovery; this module owns the cross-owner eligibility rule.
 */
export function reconcileReleasedResidueReport<T extends { readonly ownerTaskId?: string | null }, R extends {
  readonly blockAndExplain: readonly T[];
  readonly manualReview: readonly T[];
}>(cwd: string, candidateTaskId: string, report: R): R {
  const partition = partitionReleasedResidueOwners({
    cwd,
    candidateTaskId,
    ownerTaskIds: [...report.blockAndExplain, ...report.manualReview]
      .map((entry) => entry.ownerTaskId ?? '')
      .filter(Boolean),
  });
  if (partition.safeOwnerTaskIds.length === 0) {
    return report;
  }
  const transactionOwnerIds = new Set(partition.safeOwnerTaskIds);
  const isTransactionOwner = (entry: T) =>
    transactionOwnerIds.has(String(entry.ownerTaskId ?? '').trim().toUpperCase());
  return {
    ...report,
    blockAndExplain: report.blockAndExplain.filter((entry) => !isTransactionOwner(entry)),
    manualReview: report.manualReview.filter((entry) => !isTransactionOwner(entry)),
  };
}
