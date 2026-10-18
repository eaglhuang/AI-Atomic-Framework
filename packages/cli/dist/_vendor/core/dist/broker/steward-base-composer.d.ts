import type { PatchProposal } from './types.js';
export type StewardCompositionBlockCode = 'compose-context-mismatch' | 'steward-final-patch-required' | 'compose-permutation-unstable';
export interface StewardCompositionBlock {
    readonly code: StewardCompositionBlockCode;
    readonly filePath: string;
    readonly proposalIds: readonly string[];
    readonly detail: string;
}
export type BaseCompositionResult = {
    readonly ok: true;
    readonly content: string;
    readonly checkedPermutationCount: number;
} | {
    readonly ok: false;
    readonly block: StewardCompositionBlock;
};
export declare function composeTextPatchesAgainstBase(filePath: string, before: string, proposals: readonly PatchProposal[]): BaseCompositionResult;
/** Human-readable blocked reason, prefixed with its code like other steward reasons. */
export declare function formatStewardCompositionBlock(block: StewardCompositionBlock): string;
