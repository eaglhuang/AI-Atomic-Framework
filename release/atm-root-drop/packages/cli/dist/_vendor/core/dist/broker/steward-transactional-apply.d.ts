import { type StewardCommitFault } from './steward-commit-guard.js';
import { type StewardCompositionBlock } from './steward-base-composer.js';
import type { TransactionalCompositionPlan } from './transactional-composer.js';
import type { FileDescriptor, MergePlan, MigrationRecord, PatchProposal } from './types.js';
export interface StewardSemanticValidationReceipt {
    readonly schemaId: 'atm.stewardSemanticValidationReceipt.v1';
    readonly candidateDigest: string;
    readonly outputDigest: string;
    readonly ok: true;
}
export interface TransactionalStewardFileReceipt {
    readonly filePath: string;
    readonly beforeHash: string;
    readonly afterHash: string;
    readonly canonicalWriteCount: 1;
    readonly tempOutputHash: string;
}
export interface TransactionalStewardApplyReceipt {
    readonly schemaId: 'atm.transactionalStewardApplyReceipt.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly stewardId: string;
    readonly writerRole: 'neutral-steward';
    readonly compositionPlanId: string;
    readonly compositionPlanDigest: string;
    readonly serializabilityProofDigest: string;
    readonly candidateDigest: string;
    readonly canonicalRoot: string;
    readonly baseHead: string | null;
    readonly memberAttribution: TransactionalCompositionPlan['memberAttribution'];
    readonly files: readonly TransactionalStewardFileReceipt[];
    readonly verdict: 'applied' | 'blocked' | 'rolled-back' | 're-compose' | 'recovery-required';
    readonly blockedReasons: readonly string[];
    readonly compensation?: {
        readonly restoredFiles: readonly string[];
        readonly failedFile: string | null;
        readonly reason: string;
    };
}
export interface TransactionalStewardApplyResult {
    readonly ok: boolean;
    readonly receipt: TransactionalStewardApplyReceipt;
}
export declare function buildPatchProposalComposition(input: {
    readonly cwd: string;
    readonly mergePlan: MergePlan;
    readonly proposals: readonly PatchProposal[];
}): {
    readonly plan: TransactionalCompositionPlan;
    readonly outputFiles: readonly FileDescriptor[];
    /** Set when a file cannot be composed against its base; nothing may be written then. */
    readonly blocked: StewardCompositionBlock | null;
};
export declare function buildStewardSemanticValidationReceipt(input: {
    readonly plan: TransactionalCompositionPlan;
    readonly outputFiles: readonly FileDescriptor[];
}): StewardSemanticValidationReceipt;
export declare function applyTransactionalStewardPlan(input: {
    readonly cwd: string;
    readonly stewardId: string;
    readonly writerRole: 'neutral-steward';
    readonly plan: TransactionalCompositionPlan;
    readonly outputFiles: readonly FileDescriptor[];
    readonly scopeFiles: readonly string[];
    readonly semanticValidation: StewardSemanticValidationReceipt;
    readonly baseHead?: string | null;
    readonly failAfterWrites?: number;
    /**
     * Test seam. `beforePrecheck` runs before the unlocked stale check.
     * `afterPrecheck` runs after that check and temp materialization, before the
     * commit lock. Neither seam skips the commit guard or is a CLI option.
     */
    readonly commitHooks?: {
        readonly beforePrecheck?: () => void;
        readonly afterPrecheck?: () => void;
    };
    /** Directory for the cross-process commit locks. Defaults to `<cwd>/.atm/runtime/steward-commit-locks`. */
    readonly commitLockRoot?: string;
    readonly commitLockWaitMs?: number;
    readonly commitLockPollMs?: number;
    /** Test-only fault injected inside the canonical commit, never a CLI option. */
    readonly commitFault?: StewardCommitFault;
}): TransactionalStewardApplyResult;
