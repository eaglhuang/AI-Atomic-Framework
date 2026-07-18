import type { TeamPatrolFinding, TeamPatrolFindingLevel, TeamPatrolMode } from './types.ts';
export declare function buildTeamRunPatrolFindings(teamRun: Record<string, unknown> | null | undefined, input: {
    taskId: string;
    mode: TeamPatrolMode;
}): TeamPatrolFinding[];
export declare function summarizePatrolSeverity(findings: TeamPatrolFinding[]): TeamPatrolFindingLevel;
export declare function suggestedPatrolCommand(taskId: string, mode: TeamPatrolMode, severity: TeamPatrolFindingLevel): string;
export declare function buildTeamPatrolFollowUp(taskId: string, mode: TeamPatrolMode, findings: TeamPatrolFinding[]): string[];
export declare function teamPatrolFinding(input: TeamPatrolFinding): TeamPatrolFinding;
