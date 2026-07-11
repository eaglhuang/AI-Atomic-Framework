export type TeamRuntimeGateFinding = {
    code: 'ATM_TEAM_GIT_OWNER_REQUIRED' | 'ATM_TEAM_WRITE_SCOPE_EXCEEDED';
    detail: string;
    teamRunId: string;
    teamRunIds?: string[];
    taskId: string | null;
    taskIds?: string[];
    actorId: string | null;
    files: string[];
    relevantFiles?: string[];
    requiredCommand: string;
};
export declare function evaluateTeamPreToolGate(input: {
    cwd: string;
    actorId: string | null;
    files: readonly string[];
    command: string | null;
    toolName: string | null;
}): TeamRuntimeGateFinding[];
export declare function evaluateTeamPreCommitGate(input: {
    cwd: string;
    actorId: string | null;
    stagedFiles: readonly string[];
}): TeamRuntimeGateFinding[];
