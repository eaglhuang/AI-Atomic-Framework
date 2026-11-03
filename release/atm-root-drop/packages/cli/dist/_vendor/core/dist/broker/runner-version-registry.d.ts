import { type RunnerVersionCapabilityProof, type RunnerVersionLifecycleState, type RunnerVersionRequirement, type RunnerVersionSelection, type RunnerVersionSelectionReceipt } from './runner-version-contract.js';
import { type RunnerRegistrySnapshot } from './runner-registry-snapshot.js';
import { type RunnerShadowFeedbackSink } from './runner-shadow-feedback-sink.js';
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
export declare function createRunnerVersionRegistry(versions: readonly PublishedRunnerVersion[]): RunnerVersionRegistry;
/**
 * Resolve a requirement to one published runner version. Preference order:
 *   1. exact sealed-source match that is trusted/published and covers all
 *      required surfaces;
 *   2. aggregate-input-tree-hash fallback (same input generation, different sha)
 *      that additionally passes the trust + compatibility + capability gate;
 *   3. fail closed with `ATM_RUNNER_SYNC_SEAL_REVALIDATION_REQUIRED`.
 */
export declare function selectRunnerVersion(registry: RunnerVersionRegistry, requirement: RunnerVersionRequirement): RunnerVersionSelection;
export declare function selectRunnerVersionWithReceipt(registry: RunnerVersionRegistry, requirement: RunnerVersionRequirement, issuedAt: string, options?: {
    readonly policyVersion?: string;
    readonly registrySnapshotDigest?: string;
    readonly shadowFeedbackSink?: RunnerShadowFeedbackSink;
}): RunnerVersionSelectionReceipt;
export declare function selectRunnerVersionFromSnapshot(snapshot: RunnerRegistrySnapshot, requirement: RunnerVersionRequirement, issuedAt: string, options?: {
    readonly shadowFeedbackSink?: RunnerShadowFeedbackSink;
}): RunnerVersionSelectionReceipt;
