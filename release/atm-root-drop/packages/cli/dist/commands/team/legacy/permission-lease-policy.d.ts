import type { evaluateTeamBrokerLane } from '../../../../../core/src/broker/team-lane.ts';
import { type PermissionFinding, type PermissionLease, type TeamPermissionValidationOptions, type TeamRecipe } from './types.ts';
export declare function validateTeamPermissionModel(recipe: TeamRecipe, writePaths: string[], options?: TeamPermissionValidationOptions): {
    ok: boolean;
    findings: PermissionFinding[];
};
export declare function buildProposalFirstParityFindings(input: {
    taskId: string;
    brokerLaneResult: ReturnType<typeof evaluateTeamBrokerLane>;
    advisoryOnly?: boolean;
}): PermissionFinding[];
export declare function buildPermissionFinding(input: {
    level: 'error' | 'warning';
    code: string;
    detail: string;
    permission?: string;
    agentIds?: string[];
    paths?: string[];
    role?: string;
}): PermissionFinding;
export declare function normalizeTeamLeasePath(value: string, repoRoot?: string): string;
export declare function normalizeRepoAbsoluteLeasePath(rawPath: string, repoRoot?: string): string | null;
export declare function deriveAllowedWriteScope(task: Record<string, unknown> | null | undefined, repoRoot?: string): string[];
export declare function normalizeTaskWriteScope(paths: string[], repoRoot?: string): string[];
export declare function mergeValidation(...reports: {
    ok: boolean;
    findings: PermissionFinding[];
}[]): {
    ok: boolean;
    findings: PermissionFinding[];
};
export declare function buildSuggestedPermissionLeases(recipe: TeamRecipe, writePaths: string[], options?: TeamPermissionValidationOptions): PermissionLease[];
