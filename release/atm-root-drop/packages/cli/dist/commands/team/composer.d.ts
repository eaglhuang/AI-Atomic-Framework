import type { TeamContributionManifest } from '../../../../core/src/team-runtime/contribution-manifest.ts';
export type TeamContributionFile = {
    readonly path: string;
    readonly sha256: string;
};
export type TeamContributionOverlay = {
    readonly manifest: TeamContributionManifest;
    readonly files: readonly TeamContributionFile[];
};
export type TeamContributionConflict = {
    readonly path: string;
    readonly hashes: readonly string[];
    readonly contributionIds: readonly string[];
};
export type TeamContributionFinalTreeFile = {
    readonly path: string;
    readonly sha256: string;
    readonly contributionIds: readonly string[];
};
export type TeamContributionScopeExpansion = {
    readonly owner: 'composer';
    readonly required: boolean;
    readonly candidateFiles: readonly string[];
    readonly reason: string | null;
};
export type TeamContributionCompositionResult = {
    readonly schemaId: 'atm.teamContributionComposition.v1';
    readonly taskId: string;
    readonly baseCommit: string;
    readonly failClosed: boolean;
    readonly finalTreeDigest: string;
    readonly finalTree: {
        readonly files: readonly TeamContributionFinalTreeFile[];
    };
    readonly conflicts: readonly TeamContributionConflict[];
    readonly scopeExpansion: TeamContributionScopeExpansion;
};
export declare function composeTeamContributionManifests(input: {
    readonly taskId: string;
    readonly baseCommit: string;
    readonly contributions: readonly TeamContributionOverlay[];
    readonly declaredScope: readonly string[];
}): TeamContributionCompositionResult;
