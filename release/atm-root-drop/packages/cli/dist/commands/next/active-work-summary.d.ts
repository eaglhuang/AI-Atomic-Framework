export type TeamLevelRecommendationInput = {
    readonly ownFiles: readonly string[];
    readonly foreignFiles: readonly string[];
    readonly stagedFiles: readonly string[];
    readonly foreignActorIds: readonly string[];
};
export type TeamLevelRecommendation = {
    readonly level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
    readonly reason: string;
    readonly ownFiles: readonly string[];
    readonly overlappingFiles: readonly string[];
    readonly foreignActors: readonly string[];
};
export declare function projectTeamLevelRecommendation(input: TeamLevelRecommendationInput): TeamLevelRecommendation;
