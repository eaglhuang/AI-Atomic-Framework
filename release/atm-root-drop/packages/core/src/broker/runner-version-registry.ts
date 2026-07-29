import {
  buildRunnerVersionSelectionReceipt,
  isTrustedRunnerVersionLifecycleState,
  RUNNER_SYNC_ERROR_CODES,
  sortedUnique,
  type RunnerVersionCapabilityProof,
  type RunnerVersionSelectionCandidate,
  type RunnerVersionLifecycleState,
  type RunnerVersionRequirement,
  type RunnerVersionSelection,
  type RunnerVersionSelectionReceipt
} from './runner-version-contract.ts';
import { type RunnerRegistrySnapshot } from './runner-registry-snapshot.ts';
import { type RunnerShadowFeedbackSink } from './runner-shadow-feedback-sink.ts';

/**
 * Deterministic registry of published runner versions (ATM-GOV-0266).
 *
 * A published runner version is identified by its immutable `sealedSourceSha`
 * and its `aggregateInputTreeHash` (consistency summary). The registry is a pure
 * index: `selectRunnerVersion` resolves a consumer requirement to exactly one
 * version or a fail-closed selection. It never mutates; callers rebuild it from
 * the durable published set.
 *
 * The aggregate hash is a *consistency summary*, not an authorization: a fallback
 * selection to a sha other than the one requested additionally requires an
 * explicit trusted/published lifecycle state, a matching compatibility identity,
 * and validator/schema capability proof. An aggregate-hash match with the right
 * surfaces alone is never sufficient.
 */

export interface PublishedRunnerVersion {
  readonly sealedSourceSha: string;
  readonly aggregateInputTreeHash: string;
  readonly publishedSurfaces: readonly string[];
  readonly publishedAt: string;
  /** Explicit lifecycle state; only trusted/published versions are selectable. */
  readonly lifecycleState: RunnerVersionLifecycleState;
  /** Compatibility identity (runner contract / ABI generation). */
  readonly compatibilityKey: string;
  /** Validators/schemas this version proved it satisfies. */
  readonly capabilityProof: RunnerVersionCapabilityProof;
}

export interface RunnerVersionRegistry {
  readonly schemaId: 'atm.runnerVersionRegistry.v1';
  readonly bySeal: ReadonlyMap<string, PublishedRunnerVersion>;
  readonly byAggregate: ReadonlyMap<string, PublishedRunnerVersion>;
  readonly versions: readonly PublishedRunnerVersion[];
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
  return { schemaId: 'atm.runnerVersionRegistry.v1', bySeal, byAggregate, versions: [...bySeal.values()].sort(compareRunnerVersions) };
}

function coversSurfaces(
  version: PublishedRunnerVersion,
  requiredSurfaces: readonly string[]
): boolean {
  const have = new Set(version.publishedSurfaces);
  return sortedUnique(requiredSurfaces).every((surface) => have.has(surface));
}

/**
 * Gate an aggregate-hash *fallback* candidate. A selection to a sha other than
 * the exact one requested must prove more than "same input generation": an
 * explicit trusted/published lifecycle, a matching compatibility identity, and
 * coverage of the required validator/schema capabilities. Returns the first
 * failed gate so the fail-closed reason is observable, or null when verified.
 */
function fallbackGateFailure(
  version: PublishedRunnerVersion,
  requirement: RunnerVersionRequirement
): string | null {
  if (!isTrustedRunnerVersionLifecycleState(version.lifecycleState)) {
    return `candidate lifecycle state '${version.lifecycleState}' is not trusted/published`;
  }
  if (requirement.compatibilityKey && version.compatibilityKey !== requirement.compatibilityKey) {
    return `candidate compatibility identity '${version.compatibilityKey}' does not match required '${requirement.compatibilityKey}'`;
  }
  const haveValidators = new Set(version.capabilityProof?.validators ?? []);
  const missingValidators = (requirement.requiredValidatorCapabilities ?? []).filter((cap) => !haveValidators.has(cap));
  if (missingValidators.length > 0) {
    return `candidate is missing required validator capability proof: ${missingValidators.join(', ')}`;
  }
  const haveSchemas = new Set(version.capabilityProof?.schemas ?? []);
  const missingSchemas = (requirement.requiredSchemaCapabilities ?? []).filter((cap) => !haveSchemas.has(cap));
  if (missingSchemas.length > 0) {
    return `candidate is missing required schema capability proof: ${missingSchemas.join(', ')}`;
  }
  return null;
}

function compareRunnerVersions(a: PublishedRunnerVersion, b: PublishedRunnerVersion): number {
  return (
    b.publishedAt.localeCompare(a.publishedAt) ||
    a.sealedSourceSha.localeCompare(b.sealedSourceSha) ||
    a.aggregateInputTreeHash.localeCompare(b.aggregateInputTreeHash)
  );
}

function candidateFor(version: PublishedRunnerVersion, requirement: RunnerVersionRequirement): RunnerVersionSelectionCandidate {
  const haveValidators = new Set(version.capabilityProof?.validators ?? []);
  const haveSchemas = new Set(version.capabilityProof?.schemas ?? []);
  const missingValidatorCapabilities = (requirement.requiredValidatorCapabilities ?? []).filter((cap) => !haveValidators.has(cap));
  const missingSchemaCapabilities = (requirement.requiredSchemaCapabilities ?? []).filter((cap) => !haveSchemas.has(cap));
  const trusted = isTrustedRunnerVersionLifecycleState(version.lifecycleState);
  const compatible = !requirement.compatibilityKey || version.compatibilityKey === requirement.compatibilityKey;
  const coversRequiredSurfaces = coversSurfaces(version, requirement.requiredSurfaces);
  const rejectionReason = !trusted
    ? `candidate lifecycle state '${version.lifecycleState}' is not trusted/published`
    : !compatible
      ? `candidate compatibility identity '${version.compatibilityKey}' does not match required '${requirement.compatibilityKey}'`
      : !coversRequiredSurfaces
        ? 'candidate does not cover every required surface'
        : missingValidatorCapabilities.length > 0
          ? `candidate is missing required validator capability proof: ${missingValidatorCapabilities.join(', ')}`
          : missingSchemaCapabilities.length > 0
            ? `candidate is missing required schema capability proof: ${missingSchemaCapabilities.join(', ')}`
            : null;
  return {
    sealedSourceSha: version.sealedSourceSha,
    aggregateInputTreeHash: version.aggregateInputTreeHash,
    lifecycleState: version.lifecycleState,
    publishedAt: version.publishedAt,
    compatibilityKey: version.compatibilityKey,
    trusted,
    compatible,
    coversRequiredSurfaces,
    missingValidatorCapabilities,
    missingSchemaCapabilities,
    rejectionReason
  };
}

function orderedCandidates(registry: RunnerVersionRegistry, requirement: RunnerVersionRequirement): readonly RunnerVersionSelectionCandidate[] {
  return registry.versions.map((version) => candidateFor(version, requirement));
}

function failClosed(
  registry: RunnerVersionRegistry,
  requirement: RunnerVersionRequirement,
  reason: string
): RunnerVersionSelection {
  const hasAnyCandidate = registry.bySeal.size > 0;
  return {
    outcome: hasAnyCandidate ? 'seal-revalidation-required' : 'no-candidate',
    sealedSourceSha: requirement.sealedSourceSha,
    aggregateInputTreeHash: requirement.aggregateInputTreeHash ?? null,
    selectedSurfaces: [],
    orderedCandidates: orderedCandidates(registry, requirement),
    errorCode: RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired,
    reason
  };
}

/**
 * Resolve a requirement to one published runner version. Preference order:
 *   1. exact sealed-source match that is trusted/published and covers all
 *      required surfaces;
 *   2. aggregate-input-tree-hash fallback (same input generation, different sha)
 *      that additionally passes the trust + compatibility + capability gate;
 *   3. fail closed with `ATM_RUNNER_SYNC_SEAL_REVALIDATION_REQUIRED`.
 */
export function selectRunnerVersion(
  registry: RunnerVersionRegistry,
  requirement: RunnerVersionRequirement
): RunnerVersionSelection {
  const exact = registry.bySeal.get(requirement.sealedSourceSha);
  if (
    exact &&
    isTrustedRunnerVersionLifecycleState(exact.lifecycleState) &&
    coversSurfaces(exact, requirement.requiredSurfaces) &&
    (!requirement.aggregateInputTreeHash || requirement.aggregateInputTreeHash === exact.aggregateInputTreeHash)
  ) {
    return {
      outcome: 'exact-seal-match',
      sealedSourceSha: exact.sealedSourceSha,
      aggregateInputTreeHash: exact.aggregateInputTreeHash,
      selectedSurfaces: exact.publishedSurfaces,
      orderedCandidates: orderedCandidates(registry, requirement),
      errorCode: null,
      reason: 'Exact sealed-source runner version is trusted and covers all required surfaces.'
    };
  }

  if (requirement.aggregateInputTreeHash) {
    const byHash = registry.byAggregate.get(requirement.aggregateInputTreeHash);
    if (byHash && coversSurfaces(byHash, requirement.requiredSurfaces)) {
      const gateFailure = fallbackGateFailure(byHash, requirement);
      if (!gateFailure) {
        return {
          outcome: 'aggregate-hash-match',
          sealedSourceSha: byHash.sealedSourceSha,
          aggregateInputTreeHash: byHash.aggregateInputTreeHash,
          selectedSurfaces: byHash.publishedSurfaces,
          orderedCandidates: orderedCandidates(registry, requirement),
          errorCode: null,
          reason: 'Aggregate input-tree-hash matches a trusted, compatibility- and capability-verified published version.'
        };
      }
      return failClosed(
        registry,
        requirement,
        `Aggregate-hash candidate rejected (aggregate hash + surfaces are insufficient): ${gateFailure}; seal revalidation + rebuild required.`
      );
    }
  }

  return failClosed(
    registry,
    requirement,
    registry.bySeal.size > 0
      ? 'No published version matches the required seal/aggregate and surfaces; seal revalidation + rebuild required.'
      : 'No published runner versions are registered; a sealed build must run before selection.'
  );
}

export function selectRunnerVersionWithReceipt(
  registry: RunnerVersionRegistry,
  requirement: RunnerVersionRequirement,
  issuedAt: string,
  options: {
    readonly policyVersion?: string;
    readonly registrySnapshotDigest?: string;
    readonly shadowFeedbackSink?: RunnerShadowFeedbackSink;
  } = {}
): RunnerVersionSelectionReceipt {
  const selection = selectRunnerVersion(registry, requirement);
  const receipt = buildRunnerVersionSelectionReceipt(requirement, selection, issuedAt, options);
  options.shadowFeedbackSink?.append({
    observedAt: issuedAt,
    kind: 'runner-version-selection',
    runnerReceiptDigest: receipt.selectionDigest,
    details: { outcome: selection.outcome, selectedRunner: selection.sealedSourceSha }
  });
  return receipt;
}

export function selectRunnerVersionFromSnapshot(
  snapshot: RunnerRegistrySnapshot,
  requirement: RunnerVersionRequirement,
  issuedAt: string,
  options: { readonly shadowFeedbackSink?: RunnerShadowFeedbackSink } = {}
): RunnerVersionSelectionReceipt {
  return selectRunnerVersionWithReceipt(createRunnerVersionRegistry(snapshot.versions), requirement, issuedAt, {
    policyVersion: snapshot.policyVersion,
    registrySnapshotDigest: snapshot.snapshotDigest,
    shadowFeedbackSink: options.shadowFeedbackSink
  });
}
