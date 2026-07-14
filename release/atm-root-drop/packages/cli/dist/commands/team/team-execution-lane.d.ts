export type TeamStartExecutionLane = {
    executeRequested: boolean;
    providerExecutionCount: number;
    executionBlocked: boolean;
    messageCode: 'ATM_TEAM_STARTED' | 'ATM_TEAM_STARTED_EXECUTED' | 'ATM_TEAM_EXECUTION_BLOCKED';
    messageLevel: 'info' | 'error';
    messageText: string;
};
export declare function resolveTeamStartExecutionLane(input: {
    executeRequested: boolean;
    providerExecutionCount: number;
    providerResultOk: readonly boolean[];
}): TeamStartExecutionLane;
export declare function runtimeBackendAdmissionForTeam(input: {
    runtimeMode: string;
    providerId: string | null | undefined;
    executionSurface: string;
    capabilities: readonly {
        providerId: string;
        status: string;
        runtimeModes: readonly string[];
        executionSurfaces: readonly string[];
        manifestPath: string;
    }[];
}): {
    ok: boolean;
    reason: string;
};
