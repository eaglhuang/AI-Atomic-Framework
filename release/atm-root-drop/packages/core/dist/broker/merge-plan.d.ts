import type { ConflictDetail, MergePlan, PatchAnchor, PatchProposal } from './types.ts';
export declare const defaultMergePlanMigration: {
    strategy: "none";
    fromVersion: null;
    notes: string;
};
export interface PatchHunkRange {
    readonly oldStart: number;
    readonly oldLength: number;
}
export declare function anchorKey(anchor: PatchAnchor): string;
export declare function firstAnchorKey(proposal: PatchProposal): string;
export declare function compareProposalsForCompose(left: PatchProposal, right: PatchProposal): number;
export declare function sortProposalsForCompose(proposals: readonly PatchProposal[]): PatchProposal[];
export declare function parsePatchHunkRanges(patch: string): readonly PatchHunkRange[];
export declare function patchHunkRangesOverlap(left: PatchHunkRange, right: PatchHunkRange): boolean;
export declare function buildDeterministicMergePlanId(proposalIds: readonly string[]): string;
export declare function collectRequiredEvidence(proposals: readonly PatchProposal[]): readonly string[];
export declare function resolveMergePlanApplyMethod(verdict: MergePlan['verdict']): MergePlan['applyMethod'];
export declare function buildMergePlan(input: {
    readonly proposals: readonly PatchProposal[];
    readonly verdict: MergePlan['verdict'];
    readonly conflicts: readonly ConflictDetail[];
}): MergePlan;
