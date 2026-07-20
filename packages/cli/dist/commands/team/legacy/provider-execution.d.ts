import { launchOpenAITeamProviderRun } from '../../../../../core/src/team-runtime/providers/openai.ts';
import { type TeamProviderHttpExecutor } from '../../../../../core/src/team-runtime/provider-contract.ts';
import { createTeamObservabilityEvent } from '../../../../../core/src/team-runtime/observability.ts';
import { runProviderOrchestration } from '../../../../../core/src/team-runtime/execution-orchestrator.ts';
import type { TeamRecipe, TeamRuntimeContract, TeamRuntimeMode, TeamRuntimePilot, TeamVendorLocalSecretsSummary } from './types.ts';
export type DirectTeamRoleHandoffArtifact = {
    readonly role: string;
    readonly providerId: string;
    readonly outputTextPreview: string;
};
type DirectTeamProviderRoleResult = Awaited<ReturnType<typeof runProviderOrchestration>> & {
    readonly providerRunArtifact: Awaited<ReturnType<typeof launchOpenAITeamProviderRun>>['artifact'];
    readonly handoffArtifact: DirectTeamRoleHandoffArtifact;
    readonly contextTelemetry: {
        readonly baseInstructionChars: number;
        readonly handoffChars: number;
        readonly totalInstructionChars: number;
        readonly actualTokenCount: number;
        readonly tokenEstimatorId: 'whitespace-v1';
        readonly priorArtifactCount: number;
        readonly consumedArtifactRefs: readonly string[];
    };
};
export declare const TEAM_HANDOFF_CONTEXT_PER_ARTIFACT_TOKENS = 256;
export declare const TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS = 4;
export declare const TEAM_HANDOFF_CONTEXT_TOTAL_TOKENS = 1024;
export declare function runTeamProviderExecution(input: {
    cwd: string;
    taskId: string;
    teamRunId: string;
    recipe: TeamRecipe;
    runtimeContract: TeamRuntimeContract;
    runtimePilot: TeamRuntimePilot;
    roleSelections: readonly {
        role: string;
        selectedProvider: {
            providerId: string;
            sdkId: string;
            modelId: string;
            runtimeMode: TeamRuntimeMode;
        };
    }[];
    scopedPaths: readonly string[];
    executor?: TeamProviderHttpExecutor;
}): Promise<{
    requested: boolean;
    blockedReason: string;
    results: DirectTeamProviderRoleResult[];
    localSecrets?: undefined;
} | {
    requested: boolean;
    blockedReason: null;
    localSecrets: TeamVendorLocalSecretsSummary;
    results: DirectTeamProviderRoleResult[];
}>;
export declare function buildDirectTeamRoleInstructions(input: {
    taskId: string;
    role: string;
    priorRoleArtifacts?: readonly DirectTeamRoleHandoffArtifact[];
}): {
    instructions: string;
    telemetry: DirectTeamProviderRoleResult['contextTelemetry'];
};
export declare function runDirectTeamProviderRole(input: {
    taskId: string;
    role: string;
    selection: {
        providerId: string;
        sdkId: string;
        modelId: string;
        runtimeMode: TeamRuntimeMode;
    };
    env: Record<string, string | undefined>;
    scopedPaths: readonly string[];
    priorRoleArtifacts?: readonly DirectTeamRoleHandoffArtifact[];
    executor?: TeamProviderHttpExecutor;
}): Promise<DirectTeamProviderRoleResult | null>;
export declare function loadTeamVendorLocalSecrets(cwd: string): {
    env: Record<string, string | undefined>;
    summary: TeamVendorLocalSecretsSummary;
};
export declare function appendTeamRuntimeObservabilityEvents(cwd: string, teamRunId: string, events: ReturnType<typeof createTeamObservabilityEvent>[]): void;
export {};
