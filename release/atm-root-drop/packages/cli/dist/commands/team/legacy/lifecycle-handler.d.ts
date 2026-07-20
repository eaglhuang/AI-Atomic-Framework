import { type TeamLifecycleAction } from './types.ts';
export declare function normalizeTeamLifecyclePaths(value: unknown): string[];
export declare function runTeamLifecycleAction(input: {
    cwd: string;
    action: TeamLifecycleAction;
    teamRunId: string;
    actorId: string;
    permission: string;
    paths: string[];
    reason: string;
}): import("../../shared.ts").CommandResult;
