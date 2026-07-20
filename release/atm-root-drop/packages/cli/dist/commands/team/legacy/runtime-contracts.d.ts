import type { PermissionLease, TeamArtifactHandoffContract, TeamArtifactHandoffFinding, TeamRecipe, TeamRetryBudgetContract, TeamReworkFinding, TeamReworkRoute, TeamReworkRouteStatus, TeamRoleArtifactContract } from './types.ts';
export declare function buildTeamArtifactHandoffContract(input: {
    recipe?: TeamRecipe;
    requiredRoles?: readonly string[];
    producedArtifacts?: readonly string[];
}): TeamArtifactHandoffContract;
export declare function validateTeamArtifactHandoff(input: {
    roleContracts: readonly TeamRoleArtifactContract[];
    producedArtifacts?: readonly string[];
}): TeamArtifactHandoffFinding[];
export declare function buildTeamRetryBudgetContract(input: {
    maxReworkCycles?: unknown;
    maxValidatorReruns?: unknown;
    maxReviewerReturns?: unknown;
    usedReworkCycles?: unknown;
    usedValidatorReruns?: unknown;
    usedReviewerReturns?: unknown;
    escalationTarget?: unknown;
}): TeamRetryBudgetContract;
export declare function buildTeamReworkRouteStateMachine(input: {
    findings?: readonly TeamReworkFinding[];
    requiredChecksPassed?: boolean;
    retryBudgetMax?: number;
    retryBudgetUsed?: number;
    previousStatus?: TeamReworkRouteStatus;
}): TeamReworkRoute;
export declare function buildTeamRoleArtifactContract(input: {
    agentId: string;
    role: string;
}): TeamRoleArtifactContract;
export declare function transitionTeamReworkRoute(current: TeamReworkRoute, input: {
    findings?: readonly TeamReworkFinding[];
    requiredChecksPassed?: boolean;
    retryBudgetUsed?: number;
}): TeamReworkRoute;
export type RuntimeContractPermissionLease = PermissionLease;
