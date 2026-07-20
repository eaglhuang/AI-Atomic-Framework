import type { TeamPatrolFinding, TeamPatrolMode } from './types.ts';
export declare function buildTeamPatrolResult(input: {
    cwd: string;
    taskId: string;
    mode: TeamPatrolMode;
    requestedTeamRunId: string;
}): import("../../shared.ts").CommandResult;
export declare function buildTeamPatrolReport(input: {
    cwd: string;
    taskId: string;
    mode: TeamPatrolMode;
    requestedTeamRunId: string;
}): {
    schemaId: string;
    action: string;
    readOnly: boolean;
    runtimeWritten: boolean;
    historyWritten: boolean;
    agentsSpawned: boolean;
    mutations: never[];
    taskId: string;
    runId: string;
    patrolTeam: string[];
    mode: TeamPatrolMode;
    severity: import("./types.ts").TeamPatrolFindingLevel;
    safeToProceed: boolean;
    findings: TeamPatrolFinding[];
    suggestedCommand: string;
    followUp: string[];
    task: {
        taskId: string;
        title: {};
        status: {} | null;
        targetRepo: {} | null;
        sourcePlanPath: {} | null;
    };
    inspected: {
        taskPath: string;
        evidencePath: string;
        closurePacketPath: string;
        teamRunId: any;
        teamRunPath: string | null;
        runtimeRoot: string;
        historyRoot: string;
    };
};
export declare function normalizeTeamPatrolMode(value: unknown): TeamPatrolMode;
