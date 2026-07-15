export type TeamShadowWorkspaceProviderPlan = {
    readonly schemaId: 'atm.teamShadowWorkspaceProvider.v1';
    readonly mode: 'ephemeral-detached-worktree';
    readonly shadowOnly: true;
    readonly baseCommit: string;
    readonly isolatedIndexEnv: 'GIT_INDEX_FILE';
    readonly cleanupRequired: true;
    readonly writebackToPrimaryWorktree: false;
};
export type ProvisionedTeamShadowWorkspace = TeamShadowWorkspaceProviderPlan & {
    readonly repoRoot: string;
    readonly tempRoot: string;
    readonly workspacePath: string;
    readonly gitIndexFile: string;
    readonly env: {
        readonly GIT_INDEX_FILE: string;
    };
};
export declare function createTeamShadowWorkspaceProviderPlan(input: {
    readonly baseCommit: string;
}): TeamShadowWorkspaceProviderPlan;
export declare function provisionTeamShadowWorkspace(input: {
    readonly repoRoot: string;
    readonly baseCommit: string;
    readonly tempRoot?: string;
}): ProvisionedTeamShadowWorkspace;
export declare function cleanupTeamShadowWorkspace(workspace: Pick<ProvisionedTeamShadowWorkspace, 'repoRoot' | 'tempRoot' | 'workspacePath'>): void;
