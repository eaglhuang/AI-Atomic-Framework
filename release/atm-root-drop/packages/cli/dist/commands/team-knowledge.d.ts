export type TeamKnowledgeSummary = {
    schemaId: 'atm.teamKnowledgeSummary.v1';
    advisoryOnly: true;
    taskId: string;
    indexStatus: 'ready' | 'missing';
    top: number;
    hits: Array<{
        path: string;
        title: string;
        score: number;
        reason: string;
        snippet: string;
    }>;
    followUpCommand: string;
    buildCommand?: string;
};
export declare function runTeamKnowledge(argv: string[], inheritedCwd?: string): Promise<import("./shared.ts").CommandResult>;
export declare function buildTeamKnowledgeSummary(input: {
    cwd: string;
    taskId: string;
    top?: number;
}): TeamKnowledgeSummary;
