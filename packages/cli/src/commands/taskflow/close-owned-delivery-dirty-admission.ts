import { classifyRunnerAffectingPaths } from '../../../../core/src/broker/runner-version-contract.ts';
import type { HistoricalClosePreflightSummary } from './historical-close-preflight.ts';

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isCloseOwnedDeliveryPath(filePath: string, closeOwnedDeliveryFiles: readonly string[]): boolean {
  const normalized = normalizeRepoPath(filePath);
  return closeOwnedDeliveryFiles.some((owned) => {
    const declared = normalizeRepoPath(owned);
    return normalized === declared || normalized.startsWith(`${declared.replace(/\/$/, '')}/`);
  });
}

export function extractCloseOwnedDeliveryFiles(previewCommitBundle: unknown): string[] {
  if (!previewCommitBundle || typeof previewCommitBundle !== 'object' || Array.isArray(previewCommitBundle)) {
    return [];
  }
  const record = previewCommitBundle as Record<string, unknown>;
  if (Array.isArray(record.targetDeliveryFiles)) {
    return uniqueSorted(record.targetDeliveryFiles.filter((entry): entry is string => typeof entry === 'string'));
  }
  const targetRepo = record.targetRepo;
  if (targetRepo && typeof targetRepo === 'object' && !Array.isArray(targetRepo)) {
    const stageFiles = (targetRepo as { stageFiles?: unknown }).stageFiles;
    if (Array.isArray(stageFiles)) {
      return uniqueSorted(stageFiles.filter((entry): entry is string => (
        typeof entry === 'string' && !normalizeRepoPath(entry).startsWith('.atm/')
      )));
    }
  }
  return [];
}

export function applyCloseOwnedNonRunnerDeliveryDirtyAdmission(input: {
  readonly preflight: HistoricalClosePreflightSummary;
  readonly closeOwnedDeliveryFiles: readonly string[];
}): HistoricalClosePreflightSummary {
  const dirtyGuard = input.preflight.dirtyGuard;
  const admitted: string[] = [];
  const remainingScope: string[] = [];
  for (const filePath of dirtyGuard.scopeTrackedDirtyFiles) {
    const normalized = normalizeRepoPath(filePath);
    const runnerAffecting = classifyRunnerAffectingPaths([normalized]).runnerAffecting.length > 0;
    if (isCloseOwnedDeliveryPath(normalized, input.closeOwnedDeliveryFiles) && !runnerAffecting) {
      admitted.push(normalized);
    } else {
      remainingScope.push(normalized);
    }
  }
  if (admitted.length === 0) {
    return input.preflight;
  }

  const admittedSet = new Set(admitted);
  const remainingBlocking = uniqueSorted(
    dirtyGuard.blockingTrackedDirtyFiles.filter((filePath) => !admittedSet.has(normalizeRepoPath(filePath)))
  );
  const adjustedDirtyGuard = {
    ...dirtyGuard,
    ok: remainingBlocking.length === 0,
    reason: remainingBlocking.length === 0 ? 'no-blocking-dirty-files' as const : dirtyGuard.reason,
    blockingTrackedDirtyFiles: remainingBlocking,
    scopeTrackedDirtyFiles: remainingScope,
    advisoryTrackedDirtyFiles: uniqueSorted([...dirtyGuard.advisoryTrackedDirtyFiles, ...admitted])
  };
  const dropScopeBlocker = remainingScope.length === 0;
  const blockers = input.preflight.blockers.filter((entry) => !(dropScopeBlocker && entry.id === 'scopeTrackedDirtyFiles'));
  const operationalBlockers = input.preflight.operationalBlockers.filter((entry) => !(dropScopeBlocker && entry.id === 'scopeTrackedDirtyFiles'));
  return {
    ...input.preflight,
    ok: blockers.length === 0 && adjustedDirtyGuard.ok,
    blockers,
    operationalBlockers,
    scopeTrackedDirtyFiles: remainingScope,
    dirtyGuard: adjustedDirtyGuard
  };
}
