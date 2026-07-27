import {
  buildRunnerVersionSelectionReceipt,
  RUNNER_SYNC_ERROR_CODES,
  sortedUnique,
  type RunnerVersionRequirement,
  type RunnerVersionSelection,
  type RunnerVersionSelectionReceipt
} from './runner-version-contract.ts';

/**
 * Deterministic registry of published runner versions (ATM-GOV-0266 Phase A).
 *
 * A published runner version is identified by its immutable `sealedSourceSha`
 * and its `aggregateInputTreeHash` (consistency summary). The registry is a pure
 * index: `selectRunnerVersion` resolves a consumer requirement to exactly one
 * version or a fail-closed selection. It never mutates; callers rebuild it from
 * the durable published set.
 */

export interface PublishedRunnerVersion {
  readonly sealedSourceSha: string;
  readonly aggregateInputTreeHash: string;
  readonly publishedSurfaces: readonly string[];
  readonly publishedAt: string;
}

export interface RunnerVersionRegistry {
  readonly schemaId: 'atm.runnerVersionRegistry.v1';
  readonly bySeal: ReadonlyMap<string, PublishedRunnerVersion>;
  readonly byAggregate: ReadonlyMap<string, PublishedRunnerVersion>;
}

export function createRunnerVersionRegistry(
  versions: readonly PublishedRunnerVersion[]
): RunnerVersionRegistry {
  const bySeal = new Map<string, PublishedRunnerVersion>();
  const byAggregate = new Map<string, PublishedRunnerVersion>();
  // Newest publishedAt wins on collision, so the index is deterministic.
  const ordered = [...versions].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  for (const version of ordered) {
    const normalized: PublishedRunnerVersion = {
      ...version,
      publishedSurfaces: sortedUnique(version.publishedSurfaces)
    };
    bySeal.set(normalized.sealedSourceSha, normalized);
    byAggregate.set(normalized.aggregateInputTreeHash, normalized);
  }
  return { schemaId: 'atm.runnerVersionRegistry.v1', bySeal, byAggregate };
}

function coversSurfaces(
  version: PublishedRunnerVersion,
  requiredSurfaces: readonly string[]
): boolean {
  const have = new Set(version.publishedSurfaces);
  return sortedUnique(requiredSurfaces).every((surface) => have.has(surface));
}

/**
 * Resolve a requirement to one published runner version. Preference order:
 *   1. exact sealed-source match that covers all required surfaces;
 *   2. aggregate-input-tree-hash match (same input generation, different sha);
 *   3. fail closed with `ATM_RUNNER_SYNC_SEAL_REVALIDATION_REQUIRED`.
 */
export function selectRunnerVersion(
  registry: RunnerVersionRegistry,
  requirement: RunnerVersionRequirement
): RunnerVersionSelection {
  const exact = registry.bySeal.get(requirement.sealedSourceSha);
  if (exact && coversSurfaces(exact, requirement.requiredSurfaces)) {
    if (!requirement.aggregateInputTreeHash || requirement.aggregateInputTreeHash === exact.aggregateInputTreeHash) {
      return {
        outcome: 'exact-seal-match',
        sealedSourceSha: exact.sealedSourceSha,
        aggregateInputTreeHash: exact.aggregateInputTreeHash,
        selectedSurfaces: exact.publishedSurfaces,
        errorCode: null,
        reason: 'Exact sealed-source runner version covers all required surfaces.'
      };
    }
  }

  if (requirement.aggregateInputTreeHash) {
    const byHash = registry.byAggregate.get(requirement.aggregateInputTreeHash);
    if (byHash && coversSurfaces(byHash, requirement.requiredSurfaces)) {
      return {
        outcome: 'aggregate-hash-match',
        sealedSourceSha: byHash.sealedSourceSha,
        aggregateInputTreeHash: byHash.aggregateInputTreeHash,
        selectedSurfaces: byHash.publishedSurfaces,
        errorCode: null,
        reason: 'Aggregate input-tree-hash matches a published version of the same input generation.'
      };
    }
  }

  const hasAnyCandidate = registry.bySeal.size > 0;
  return {
    outcome: hasAnyCandidate ? 'seal-revalidation-required' : 'no-candidate',
    sealedSourceSha: requirement.sealedSourceSha,
    aggregateInputTreeHash: requirement.aggregateInputTreeHash ?? null,
    selectedSurfaces: [],
    errorCode: RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired,
    reason: hasAnyCandidate
      ? 'No published version matches the required seal/aggregate and surfaces; seal revalidation + rebuild required.'
      : 'No published runner versions are registered; a sealed build must run before selection.'
  };
}

export function selectRunnerVersionWithReceipt(
  registry: RunnerVersionRegistry,
  requirement: RunnerVersionRequirement,
  issuedAt: string
): RunnerVersionSelectionReceipt {
  return buildRunnerVersionSelectionReceipt(requirement, selectRunnerVersion(registry, requirement), issuedAt);
}
