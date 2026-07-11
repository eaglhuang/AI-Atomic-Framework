import type { TeamProviderContract, TeamProviderSessionRequest, TeamProviderStepResult } from './provider-contract.ts';
export type TeamOrchestrationRequest = TeamProviderSessionRequest & {
    readonly retries?: number;
    readonly env?: Record<string, string | undefined>;
};
export type TeamOrchestrationResult = {
    readonly ok: boolean;
    readonly attempts: number;
    readonly sessionId: string;
    readonly providerId: string;
    readonly coordinatorOwnedAuthority: true;
    readonly stepResult: TeamProviderStepResult;
};
export declare function runProviderOrchestration(provider: TeamProviderContract, request: TeamOrchestrationRequest): Promise<TeamOrchestrationResult>;
