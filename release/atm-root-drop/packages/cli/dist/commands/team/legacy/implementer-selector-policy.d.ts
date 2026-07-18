import type { TeamImplementerSelector, TeamLevel, TeamRecipe, TeamRecipeAgent } from './types.ts';
export declare function mapTeamSizeToLevel(value: unknown): TeamLevel;
export declare function projectTeamRecipeForLevel(recipe: TeamRecipe, teamLevel: TeamLevel): {
    recipe: {
        agents: TeamRecipeAgent[];
        schemaId: "atm.teamRecipe.v1";
        recipeId: string;
        appliesTo?: string[];
        language?: string;
    };
    projection: {
        schemaId: string;
        teamLevel: TeamLevel;
        teamSize: string;
        activeRoles: string[];
        syntheticRoles: string[];
        deferredRoles: string[];
        catalogReadyRosterDeferredRoles: string[];
        roleRules: {
            L1: string;
            L2: string;
            L3: string;
            L4: string;
            L5: string;
        };
    };
};
export declare function selectTeamImplementer(task: Record<string, unknown> | null | undefined, recipe: TeamRecipe, writePaths: string[]): TeamImplementerSelector;
