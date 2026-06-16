export interface MigrationRecord {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
}
export interface WriteIntentAtomRef {
    readonly atomId: string;
    readonly atomCid: string;
    readonly operation: 'create' | 'modify' | 'delete';
    readonly sourceRange?: {
        readonly filePath: string;
        readonly lineStart: number;
        readonly lineEnd: number;
    };
}
export interface LineRange {
    readonly filePath: string;
    readonly lineStart: number;
    readonly lineEnd: number;
}
export interface DecompositionTargetFunction {
    readonly atomId: string;
    readonly atomCid: string;
    readonly symbol: string;
    readonly sourceRange: LineRange;
}
export interface DecompositionRequest {
    readonly targetFunction: DecompositionTargetFunction;
    readonly conflictRegion: LineRange;
    readonly constraint: 'preserve-signature';
}
export interface SharedSurfacesRecord {
    readonly generators: readonly string[];
    readonly projections: readonly string[];
    readonly registries: readonly string[];
    readonly validators: readonly string[];
    readonly artifacts: readonly string[];
}
export interface WriteIntent {
    readonly schemaId: 'atm.writeIntent.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly taskId: string;
    readonly actorId: string;
    readonly baseCommit: string;
    readonly targetFiles: readonly string[];
    readonly atomRefs: readonly WriteIntentAtomRef[];
    readonly readAtoms?: readonly WriteIntentAtomRef[];
    readonly sharedSurfaces: SharedSurfacesRecord;
    readonly requestedLane: 'auto' | 'direct-brokered' | 'deterministic-composer' | 'neutral-steward' | 'serial' | 'blocked';
    readonly leaseBounds?: LeaseBounds;
}
export interface LeaseBounds {
    readonly requestedSeconds: number;
    readonly maxSeconds: number;
}
export interface ProposalAtomRef {
    readonly atomId: string;
    readonly atomCid: string;
}
export interface PatchAnchor {
    readonly kind: string;
    readonly hint: string;
}
export interface PatchProposal {
    readonly schemaId: 'atm.patchProposal.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly proposalId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly baseCommit: string;
    readonly fileBeforeHash: string;
    readonly targetFile: string;
    readonly atomRefs: readonly ProposalAtomRef[];
    readonly anchors: readonly PatchAnchor[];
    readonly intent: string;
    readonly patch: string;
    readonly validators: readonly string[];
    readonly rollback: string;
}
export interface ConflictDetail {
    readonly kind: 'cid' | 'file-range' | 'generator' | 'projection' | 'validator' | 'registry' | 'artifact' | 'lease';
    readonly detail: string;
}
export interface BrokerDecision {
    readonly schemaId: 'atm.brokerDecision.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly intentId: string;
    readonly taskId: string;
    readonly verdict: 'parallel-safe' | 'needs-physical-split' | 'blocked-cid-conflict' | 'blocked-shared-surface' | 'serial' | 'blocked-active-lease';
    readonly lane: 'direct-brokered' | 'deterministic-composer' | 'neutral-steward' | 'serial' | 'blocked';
    readonly conflicts: readonly ConflictDetail[];
    readonly conflictMatrix?: BrokerConflictMatrix;
    readonly decompositionRequest?: DecompositionRequest | null;
    readonly stewardId?: string | null;
    readonly applyMethod: 'patch-apply' | 'ast-rewrite' | 'git-three-way-fallback' | 'steward-authored-final-patch' | 'none';
    readonly reason: string;
}
export interface MergePlan {
    readonly schemaId: 'atm.mergePlan.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly mergePlanId: string;
    readonly inputProposals: readonly string[];
    readonly verdict: 'parallel-safe' | 'needs-steward' | 'blocked-cid-conflict' | 'blocked-shared-surface';
    readonly conflicts: readonly ConflictDetail[];
    readonly applyMethod: 'patch-apply' | 'ast-rewrite' | 'git-three-way-fallback' | 'steward-authored-final-patch';
    readonly requiredEvidence: readonly string[];
}
export interface BreakGlassCidCheck {
    readonly verdict: 'disjoint' | 'conflict';
    readonly leadAtomCid: string;
    readonly donorAtomCid: string;
}
export interface BreakGlassAcceptanceSplit {
    readonly leadTaskAcceptance: readonly string[];
    readonly donorTaskAcceptance: readonly string[];
}
export interface BreakGlassHandoff {
    readonly schemaId: 'atm.breakGlassHandoff.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly reason: 'write-agent-unavailable' | 'steward-pool-exhausted' | 'emergency-unblock';
    readonly captainApproval: true;
    readonly leadActorId: string;
    readonly donorActorId: string;
    readonly leadTaskId: string;
    readonly donorTaskId: string;
    readonly cidCheck: BreakGlassCidCheck;
    readonly transferredIntent: string;
    readonly expandedScope: readonly string[];
    readonly forbiddenExpansion: readonly string[];
    readonly acceptanceSplit: BreakGlassAcceptanceSplit;
    readonly rollback: string;
}
export interface ActiveWriteIntent {
    readonly intentId: string;
    readonly taskId: string;
    readonly teamRunId: string | null;
    readonly actorId: string;
    readonly baseCommit: string;
    readonly resourceKeys: {
        readonly files: readonly string[];
        readonly atomIds: readonly string[];
        readonly atomCids: readonly string[];
        readonly generators: readonly string[];
        readonly projections: readonly string[];
        readonly registries: readonly string[];
        readonly validators: readonly string[];
        readonly artifacts: readonly string[];
        readonly atomRanges?: readonly {
            readonly filePath: string;
            readonly lineStart: number;
            readonly lineEnd: number;
            readonly atomCid: string;
        }[];
    };
    readonly leaseEpoch: number;
    readonly leaseSeconds: number;
    readonly leaseMaxSeconds: number;
    readonly heartbeatAt: string;
    readonly lane: 'direct-brokered' | 'deterministic-composer' | 'neutral-steward' | 'serial' | 'blocked';
    readonly expiresAt?: string;
}
export interface WriteBrokerRegistryDocument {
    readonly schemaId: 'atm.writeBrokerRegistry.v1';
    readonly specVersion: '0.1.0';
    readonly repoId: string;
    readonly workspaceId: string;
    readonly activeIntents: readonly ActiveWriteIntent[];
}
export type BrokerArbitrationVerdict = 'allow' | 'watch' | 'freeze' | 'takeover';
export interface BrokerConflictClassResult {
    readonly kind: 'shared-surface' | 'cid' | 'read-set' | 'file-range' | 'intent-shape' | 'lease';
    readonly detail: string;
    readonly blockingTask: string;
}
export interface BrokerConflictMatrix {
    readonly schemaId: 'atm.brokerConflictMatrix.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly taskId: string;
    readonly arbitrationVerdict: BrokerArbitrationVerdict;
    readonly conflicts: readonly BrokerConflictClassResult[];
}
/**
 * Describes the file a mutation targets. `content` is the current on-disk text
 * (opaque to the registry; each adapter parses it in its own format).
 */
export interface FileDescriptor {
    readonly filePath: string;
    readonly content: string;
}
/**
 * A single requested mutation against a file, expressed in adapter-neutral
 * terms. `op` is the format-specific operation name (e.g. 'upsert',
 * 'increment', 'append'); `target` identifies the sub-file location
 * (JSON pointer, heading text, scalar key, ...); `value` is the payload.
 */
export interface MutationRequest {
    readonly schemaId: 'atm.mutationRequest.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly requestId: string;
    readonly actorId: string;
    readonly filePath: string;
    readonly op: string;
    readonly target: string;
    readonly value?: unknown;
}
/**
 * An adapter-normalized mutation: the registry-neutral request after the
 * adapter has resolved/validated the operation against the parsed document.
 */
export interface NormalizedMutation {
    readonly requestId: string;
    readonly actorId: string;
    readonly filePath: string;
    readonly op: string;
    readonly target: string;
    readonly value?: unknown;
}
export type ConflictKeyScope = 'file' | 'record' | 'range' | 'line' | 'scalar' | 'semantic';
/**
 * A fine-grained, comparable key identifying the sub-file surface a mutation
 * touches. Two mutations whose conflict keys collide on `key` (within the same
 * scope) are candidates for conflict; disjoint keys are independent.
 */
export interface ConflictKey {
    readonly schemaId: 'atm.conflictKey.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly scope: ConflictKeyScope;
    readonly key: string;
}
export type MergeVerdict = 'mergeable' | 'commutative-merge' | 'conflict';
/**
 * The decision an adapter reaches when asked whether two (or more) mutations
 * to the same file can be combined.
 */
export interface MergeDecision {
    readonly schemaId: 'atm.mergeDecision.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly verdict: MergeVerdict;
    readonly reason: string;
    readonly conflictKeys: readonly ConflictKey[];
}
/**
 * The result of an adapter parsing a file's content into its own in-memory
 * representation. `value` is adapter-private (parsed JSON, line array, ...).
 */
export interface ParsedDocument {
    readonly filePath: string;
    readonly value: unknown;
}
export interface ValidationResult {
    readonly ok: boolean;
    readonly errors: readonly string[];
}
/**
 * The pluggable per-format adapter contract. The broker registry resolves a
 * file to exactly one adapter via `supports()`. The broker core stays
 * format-agnostic; all format knowledge lives behind this interface.
 */
export interface FileMutationAdapter {
    readonly id: string;
    supports(file: FileDescriptor): boolean;
    parse(file: FileDescriptor): ParsedDocument;
    normalize(request: MutationRequest): NormalizedMutation;
    getConflictKeys(mutation: NormalizedMutation, parsed: ParsedDocument): readonly ConflictKey[];
    canMerge(mutations: readonly NormalizedMutation[], parsed: ParsedDocument): MergeDecision;
    merge(mutations: readonly NormalizedMutation[], parsed: ParsedDocument): ParsedDocument;
    serialize(parsed: ParsedDocument): string;
    validate?(file: FileDescriptor): ValidationResult;
}
/**
 * A group of normalized mutations against a single file that the planner has
 * determined can be applied together. `verdict` mirrors the adapter merge
 * verdict that justified grouping them (mergeable or commutative-merge).
 */
export interface MutationBatch {
    readonly filePath: string;
    readonly adapterId: string;
    readonly verdict: Extract<MergeVerdict, 'mergeable' | 'commutative-merge'>;
    readonly requestIds: readonly string[];
    readonly conflictKeys: readonly ConflictKey[];
}
/**
 * The deterministic plan produced by `planMutationBatch`. Batches hold
 * co-applicable mutations; `queued` holds requests deferred because they
 * conflict with an earlier batch on the same file; `blocked` holds requests an
 * adapter rejected outright. `planId` is a content hash of the sorted request
 * ids, mirroring the merge-plan deterministic-id idiom.
 */
export interface MutationBatchPlan {
    readonly schemaId: 'atm.mutationBatchPlan.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly planId: string;
    readonly batches: readonly MutationBatch[];
    readonly queued: readonly string[];
    readonly blocked: readonly string[];
}
/**
 * One mutation-level evidence entry attached (optionally) to steward apply
 * evidence so a brokered write records, per request, which adapter handled it,
 * the base/result content hashes, the conflict keys it claimed, the adapter's
 * merge decision verdict, and the final apply verdict.
 */
export interface BrokerMutationEvidenceEntry {
    readonly requestId: string;
    readonly actorId: string;
    readonly adapterId: string;
    readonly filePath: string;
    readonly baseHash: string;
    readonly resultHash: string;
    readonly conflictKeys: readonly ConflictKey[];
    readonly mergeDecision: MergeVerdict;
    readonly verdict: 'applied' | 'queued' | 'blocked';
}
/** Shared default migration record for adapter-emitted envelopes. */
export declare function brokerAdapterMigration(): MigrationRecord;
