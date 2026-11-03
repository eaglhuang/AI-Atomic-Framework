/**
 * Runner-sync sealed-input and version/selection contract (ATM-GOV-0266 Phase A).
 *
 * This module owns the *data-shaped* half of the runner-sync session policy: the
 * content-addressed sealed-input graph, the runner version requirement/selection
 * types, and the version-selection receipt. It is pure and side-effect free; the
 * session state machine (`runner-sync-session.ts`) composes these types into a
 * durable lifecycle, and the registry (`runner-version-registry.ts`) indexes
 * published versions for selection.
 *
 * Design intent (card acceptance): the aggregate `runnerInputTreeHash` is a
 * *consistency summary*, not the only rebuild key. The `runnerInputGraph` maps
 * schema-declared input segments to package/release-entry outputs with per-node
 * input/output digests, so a runner-affecting commit after the seal can be
 * classified against the affected graph closure rather than forcing a blind
 * full rebuild.
 */
export declare const RUNNER_VERSION_SELECTION_RECEIPT_SCHEMA: "atm.runnerVersionSelectionReceipt.v1";
export declare const RUNNER_INPUT_GRAPH_SCHEMA: "atm.runnerInputGraph.v1";
/**
 * Canonical runner-sync error codes declared by ATM-GOV-0266. These are modeled
 * as named constants (INV-ATM-009: data-shaped behavior kept out of control
 * flow). Canonical cross-cutting registration in
 * `docs/governance/error-code-registry.json` is a scoped follow-up.
 */
export declare const RUNNER_SYNC_ERROR_CODES: {
    readonly sealRevalidationRequired: "ATM_RUNNER_SYNC_SEAL_REVALIDATION_REQUIRED";
    readonly stewardLeaseExpired: "ATM_RUNNER_SYNC_STEWARD_LEASE_EXPIRED";
    readonly resumeRequired: "ATM_RUNNER_SYNC_RESUME_REQUIRED";
    readonly coalescedAttributionMissing: "ATM_RUNNER_SYNC_COALESCED_ATTRIBUTION_MISSING";
};
export type RunnerSyncErrorCode = (typeof RUNNER_SYNC_ERROR_CODES)[keyof typeof RUNNER_SYNC_ERROR_CODES];
/**
 * Schema-declared input segments. A runner-affecting change lands in exactly one
 * segment; `nonRunnerAffecting` paths (planning, backlog docs, task ledgers) do
 * not invalidate an otherwise-matching sealed build.
 */
export declare const RUNNER_INPUT_SEGMENTS: readonly ["packages", "scripts", "templates", "schemas", "atomicWorkbench", "rootConfig"];
export type RunnerInputSegment = (typeof RUNNER_INPUT_SEGMENTS)[number];
/**
 * Generated runner outputs must never become sealed inputs of the generation
 * that produced them.  Keeping this as declarative path data makes both delta
 * classification and input hashing share the same boundary.
 */
export declare const RUNNER_GENERATED_OUTPUT_PREFIXES: readonly ["packages/*/dist/"];
export declare const RUNNER_INPUT_TREE_PATHS: readonly ["packages", "scripts", "templates", "schemas", "atomic_workbench", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
export declare function isRunnerGeneratedOutputPath(path: string): boolean;
/** Normalize `git ls-tree -z` output before it becomes a sealed-input digest. */
export declare function filterRunnerInputTreeListing(listing: string): string;
export interface RunnerInputGraphNode {
    readonly segment: RunnerInputSegment;
    /** Sorted repo-relative input paths contributing to this segment. */
    readonly inputPaths: readonly string[];
    /** Digest of the segment's input content. */
    readonly inputDigest: string;
    /** Sorted package dirs / release-entry outputs produced from this segment. */
    readonly outputEntries: readonly string[];
    /** Digest of the segment's produced outputs. */
    readonly outputDigest: string;
}
export interface RunnerInputGraph {
    readonly schemaId: typeof RUNNER_INPUT_GRAPH_SCHEMA;
    readonly sealedSourceSha: string;
    readonly nodes: readonly RunnerInputGraphNode[];
    /** Consistency summary over all node input digests; not the only rebuild key. */
    readonly aggregateInputTreeHash: string;
}
/**
 * Explicit lifecycle state of a published runner version. Only the *trusted*
 * states may satisfy a fallback selection. A candidate that merely shares an
 * aggregate hash but is provisional/superseded/revoked is never selectable.
 */
export type RunnerVersionLifecycleState = 'provisional' | 'published' | 'trusted' | 'superseded' | 'revoked';
/** Lifecycle states a selection may resolve to. */
export declare const TRUSTED_RUNNER_VERSION_LIFECYCLE_STATES: readonly RunnerVersionLifecycleState[];
export declare function isTrustedRunnerVersionLifecycleState(state: RunnerVersionLifecycleState | string): boolean;
/**
 * Capability proof a published version attests: the validators it passed and the
 * schema versions it can satisfy. A fallback selection must cover the consumer's
 * required capabilities — an aggregate-hash match alone is insufficient.
 */
export interface RunnerVersionCapabilityProof {
    readonly validators: readonly string[];
    readonly schemas: readonly string[];
}
export interface RunnerVersionRequirement {
    readonly sealedSourceSha: string;
    /** Optional: require a specific aggregate input tree hash (strict match). */
    readonly aggregateInputTreeHash?: string | null;
    /** Surfaces the consumer needs the runner to have published. */
    readonly requiredSurfaces: readonly string[];
    /**
     * Compatibility identity (runner contract / ABI generation). A fallback
     * selection to a different sha must present the same compatibility identity.
     */
    readonly compatibilityKey?: string | null;
    /** Validator capabilities the consumer requires the version to prove. */
    readonly requiredValidatorCapabilities?: readonly string[];
    /** Schema capabilities the consumer requires the version to prove. */
    readonly requiredSchemaCapabilities?: readonly string[];
}
export type RunnerVersionSelectionOutcome = 'exact-seal-match' | 'aggregate-hash-match' | 'seal-revalidation-required' | 'no-candidate';
export interface RunnerVersionSelection {
    readonly outcome: RunnerVersionSelectionOutcome;
    readonly sealedSourceSha: string;
    readonly aggregateInputTreeHash: string | null;
    readonly selectedSurfaces: readonly string[];
    readonly orderedCandidates?: readonly RunnerVersionSelectionCandidate[];
    readonly errorCode: RunnerSyncErrorCode | null;
    readonly reason: string;
}
export interface RunnerVersionSelectionCandidate {
    readonly sealedSourceSha: string;
    readonly aggregateInputTreeHash: string;
    readonly lifecycleState: RunnerVersionLifecycleState;
    readonly publishedAt: string;
    readonly compatibilityKey: string;
    readonly trusted: boolean;
    readonly compatible: boolean;
    readonly coversRequiredSurfaces: boolean;
    readonly missingValidatorCapabilities: readonly string[];
    readonly missingSchemaCapabilities: readonly string[];
    readonly rejectionReason: string | null;
}
export interface RunnerVersionSelectionReceipt {
    readonly schemaId: typeof RUNNER_VERSION_SELECTION_RECEIPT_SCHEMA;
    readonly specVersion: '0.1.0' | '0.2.0';
    readonly requirement: RunnerVersionRequirement;
    readonly selection: RunnerVersionSelection;
    readonly policyVersion?: string;
    readonly registrySnapshotDigest?: string;
    readonly selectionDigest: string;
    readonly issuedAt: string;
}
export interface RunnerAffectingClassification {
    readonly runnerAffecting: readonly string[];
    readonly nonRunnerAffecting: readonly string[];
    readonly affectedSegments: readonly RunnerInputSegment[];
}
/** Map a single repo-relative path to its runner input segment, or null. */
export declare function classifyRunnerPathSegment(path: string): RunnerInputSegment | null;
/**
 * Classify a set of changed paths into runner-affecting vs non-runner-affecting.
 * A commit that changes only non-runner paths (planning, backlog docs, `.atm`
 * ledgers) may advance HEAD without invalidating a matching sealed build.
 */
export declare function classifyRunnerAffectingPaths(paths: readonly string[]): RunnerAffectingClassification;
export interface SealContinuityInput {
    readonly graph: RunnerInputGraph;
    /** Paths changed between the sealed source and the current HEAD. */
    readonly headDeltaPaths: readonly string[];
}
export interface SealContinuityResult {
    readonly continuous: boolean;
    readonly revalidationRequired: boolean;
    readonly revalidationBoundaryGeneration?: string | null;
    readonly errorCode: RunnerSyncErrorCode | null;
    /** Graph node segments whose closure must be rebuilt+revalidated. */
    readonly affectedClosure: readonly RunnerInputSegment[];
    readonly reason: string;
}
/**
 * Decide whether a sealed build remains valid against the current HEAD. A
 * non-runner-affecting delta is continuous (reuse). A runner-affecting delta
 * returns the affected graph closure and fails closed with
 * `ATM_RUNNER_SYNC_SEAL_REVALIDATION_REQUIRED` — never publish a runner
 * assembled from mixed input generations.
 */
export declare function evaluateSealContinuity(input: SealContinuityInput): SealContinuityResult;
export declare function computeAggregateInputTreeHash(nodes: readonly RunnerInputGraphNode[]): string;
export declare function buildRunnerVersionSelectionReceipt(requirement: RunnerVersionRequirement, selection: RunnerVersionSelection, issuedAt: string, options?: {
    readonly policyVersion?: string;
    readonly registrySnapshotDigest?: string;
}): RunnerVersionSelectionReceipt;
export declare function sortedUnique(values: readonly string[]): readonly string[];
export declare function normalizePath(value: string): string;
