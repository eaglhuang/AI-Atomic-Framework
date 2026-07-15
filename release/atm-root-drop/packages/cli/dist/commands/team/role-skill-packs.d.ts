import { type TeamProviderSelectionConfig } from '../../../../core/src/team-runtime/provider-selection.ts';
type TeamRuntimeMode = 'real-agent' | 'editor-subagent' | 'broker-only';
type TeamRoleAgent = {
    role: string;
    agentId: string;
    permissions: readonly string[];
};
type TeamRoleRecipe = {
    agents: readonly TeamRoleAgent[];
};
export type TeamRoleSkillPackContract = {
    schemaId: 'atm.teamRoleSkillPackContract.v1';
    providerNeutral: true;
    coordinatorOwnsLifecycle: true;
    roles: Array<{
        role: string;
        agentId: string;
        skillPackId: string;
        specialistSkills: string[];
        allowedPermissions: string[];
        forbiddenPermissions: string[];
        playbookSlice: string;
        growthContractAttachment: string;
    }>;
};
export type TeamRoleSkillPackManifest = {
    schemaId: 'atm.teamRoleSkillPackManifest.v1';
    providerNeutral: true;
    coordinatorOwnsLifecycle: true;
    discoveryMode: 'capability-driven';
    roleFirstProviderSecond: true;
    sharedVocabulary: {
        brokerConflict: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'];
    };
    roles: Array<{
        role: string;
        skillPackId: string;
        playbookSlice: string;
        capabilityTags: string[];
        permissionLease: {
            alignment: 'role-first';
            allowedPermissions: string[];
            forbiddenPermissions: string[];
        };
        selectedProvider: {
            providerId: string;
            sdkId: string;
            modelId: string;
            runtimeMode: TeamRuntimeMode;
            source: 'repo-default' | 'cli-global-default' | 'role-override' | 'cli-role-override';
        };
        providerCapabilities: Array<{
            providerId: string;
            runtimeModes: TeamRuntimeMode[];
            artifacts: string[];
            satisfiesRolePack: true;
            reason: string;
        }>;
        growthContractAttachment: string;
    }>;
};
export type TeamRoleRoutingMatrix = {
    schemaId: 'atm.teamRoleRoutingMatrix.v1';
    providerNeutral: true;
    coordinatorOwnsLifecycle: true;
    routes: Array<{
        workstream: string;
        primaryRole: string;
        supportingRoles: string[];
        advisoryRoles: string[];
        roleOrder: string[];
        parallelSafeRoles: string[];
        advisoryOnlyRoles: string[];
        playbookSlice: string;
        lifecycleOwner: 'coordinator';
        stopConditions: string[];
    }>;
};
export declare function buildTeamRoleSkillPackContract(recipe: TeamRoleRecipe): TeamRoleSkillPackContract;
export declare function buildProviderNeutralRoleSkillPackManifest(input: {
    recipe: TeamRoleRecipe;
    roleSkillPacks?: TeamRoleSkillPackContract;
    selectionConfig?: TeamProviderSelectionConfig;
    providerIds?: readonly string[];
}): TeamRoleSkillPackManifest;
export declare function buildTeamRoleRoutingMatrix(roleSkillPacks: TeamRoleSkillPackContract): TeamRoleRoutingMatrix;
export {};
