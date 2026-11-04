import { composeTransactionalMutations, type TransactionalCompositionPlan } from './transactional-composer.js';
import type { FileDescriptor, MutationRequest } from './types.js';
/**
 * Immutable post-compose candidate materialization.
 * Serializability proves a legal order exists; this digest binds the exact
 * composed bytes that semantic validators must check before any canonical write.
 * Core never mutates the live worktree — outputs stay in-memory only.
 */
export interface PatchCandidateMaterializationInput {
    readonly baseHeadSha: string;
    readonly baseFiles: readonly FileDescriptor[];
    readonly requests: readonly MutationRequest[];
    readonly validators?: readonly string[];
    readonly adapters?: Parameters<typeof composeTransactionalMutations>[0]['adapters'];
    readonly maxPermutationChecks?: number;
    /** Declared card/proposal validators (capability ids or command refs). */
    readonly cardValidators?: readonly string[];
    /** Resolved language-adapter fast static checks (capability-driven refs). */
    readonly adapterStaticChecks?: readonly string[];
    /** Catalog-selected targeted tests (capability-driven refs). */
    readonly catalogTargetedTests?: readonly string[];
}
export interface SealedValidatorSelection {
    readonly schemaId: 'atm.sealedValidatorSelection.v1';
    readonly selectionInputDigest: string;
    readonly sealedSelectionSourceDigest: string;
    readonly requiredValidatorIds: readonly string[];
    readonly cardValidators: readonly string[];
    readonly adapterStaticChecks: readonly string[];
    readonly catalogTargetedTests: readonly string[];
}
export interface PatchCandidateMaterialization {
    readonly schemaId: 'atm.patchCandidate.v1';
    readonly specVersion: '0.1.0';
    readonly baseHeadSha: string;
    readonly candidateDigest: string;
    readonly compositionPlanDigest: string;
    readonly serializabilityProofDigest: string;
    readonly serializabilityProofPresent: boolean;
    readonly liveWorktreeMutation: false;
    readonly plan: TransactionalCompositionPlan;
    readonly outputFiles: readonly FileDescriptor[];
    readonly sealedSelection: SealedValidatorSelection;
    readonly memberAttribution: TransactionalCompositionPlan['memberAttribution'];
    readonly reasons: readonly string[];
    readonly ok: boolean;
}
/**
 * Seal the validator union before any producer can read a locked negative-control
 * fixture. Post-reveal union changes invalidate the cell (digest mismatch).
 */
export declare function sealValidatorSelection(input: {
    readonly cardValidators?: readonly string[];
    readonly adapterStaticChecks?: readonly string[];
    readonly catalogTargetedTests?: readonly string[];
}): SealedValidatorSelection;
/**
 * Materialize an exact composed candidate from an immutable base snapshot.
 * Does not write to the live worktree.
 */
export declare function materializePatchCandidate(input: PatchCandidateMaterializationInput): PatchCandidateMaterialization;
export declare function digestCandidate(plan: TransactionalCompositionPlan, outputFiles: readonly FileDescriptor[]): string;
