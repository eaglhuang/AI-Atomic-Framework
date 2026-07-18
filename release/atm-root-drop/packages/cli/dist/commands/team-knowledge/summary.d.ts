import type { TeamKnowledgeSummary } from './types.ts';
export declare function buildTeamKnowledgeSummary(input: {
    cwd: string;
    taskId: string;
    top?: number;
}): TeamKnowledgeSummary;
