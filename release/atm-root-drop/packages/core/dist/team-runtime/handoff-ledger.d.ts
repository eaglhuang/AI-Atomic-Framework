export declare const TEAM_HANDOFF_SOFT_TRANSITIONS = 48;
export declare const TEAM_HANDOFF_HARD_TRANSITIONS = 64;
export declare const TEAM_HANDOFF_SOFT_BYTES: number;
export declare const TEAM_HANDOFF_HARD_BYTES: number;
export type TeamRoleHandoffArtifact = {
    readonly schemaId: 'atm.teamRoleHandoffArtifact.v1';
    readonly handoffId: string;
    readonly sequence: number;
    readonly taskId: string;
    readonly teamRunId: string;
    readonly from: {
        readonly role: string;
        readonly providerId: string;
        readonly modelId: string;
    };
    readonly to: {
        readonly role: string | null;
        readonly providerId: string | null;
    };
    readonly createdAt: string;
    readonly leaseEpoch: number;
    readonly sourceArtifact: {
        readonly schemaId: 'atm.teamProviderRunArtifact.v1';
        readonly artifactId: string;
        readonly sha256: string;
    };
    readonly humanSummary: string;
    readonly routeNote: string | null;
    readonly decision: {
        readonly decisionClass: string;
        readonly decisionReason: string | null;
        readonly violationStatus: string | null;
    };
    readonly redaction: {
        readonly rawSecretsStored: false;
        readonly source: 'provider-preview';
        readonly redactedFields: readonly string[];
    };
    readonly previousHandoffSha256: string | null;
};
export type TeamHandoffManifest = {
    readonly schemaId: 'atm.teamRoleHandoffManifest.v1';
    readonly taskId: string;
    readonly teamRunId: string;
    readonly runOutcome: 'running' | 'completed' | 'aborted' | 'failed';
    readonly transitionCount: number;
    readonly artifacts: readonly {
        readonly sequence: number;
        readonly file: string;
        readonly sha256: string;
        readonly previousHandoffSha256: string | null;
    }[];
    readonly rootHandoffSha256: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
};
export type TeamHandoffStats = {
    readonly transitionCount: number;
    readonly bytes: number;
    readonly softLimitReached: boolean;
    readonly hardLimitReached: boolean;
};
export type TeamHandoffRetentionDecision = {
    readonly decisionClass: 'auto-execution' | 'human-signoff-required';
    readonly violationStatus: 'none' | 'warning' | 'human-signoff-required';
    readonly statusCode: 'none' | 'handoff-soft-limit-warning' | 'handoff-hard-limit-reached';
    readonly summary: string;
};
export declare function buildTeamHandoffRetentionDecision(stats: TeamHandoffStats): TeamHandoffRetentionDecision;
export declare function teamHandoffRuntimeDirectory(cwd: string, taskId: string, teamRunId: string): string;
export declare function teamHandoffHistoryDirectory(cwd: string, taskId: string, teamRunId: string): string;
/** Coordinator-only archive promotion. Callers commit the returned history path in the task closure bundle. */
export declare function promoteTeamHandoffArchive(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly teamRunId: string;
    readonly runOutcome: 'completed' | 'aborted' | 'failed';
}): {
    readonly historyPath: string;
    readonly manifest: TeamHandoffManifest;
};
export declare function materializeTeamRoleHandoff(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly teamRunId: string;
    readonly fromRole: string;
    readonly fromProviderId: string;
    readonly fromModelId: string;
    readonly toRole?: string | null;
    readonly toProviderId?: string | null;
    readonly sourceArtifactId: string;
    readonly redactedPreview: string;
    readonly leaseEpoch: number;
    readonly decisionClass?: string;
    readonly decisionReason?: string | null;
    readonly violationStatus?: string | null;
    readonly routeNote?: string | null;
    readonly createdAt?: string;
}): {
    artifact: TeamRoleHandoffArtifact;
    manifest: TeamHandoffManifest;
    stats: TeamHandoffStats;
};
export declare function verifyTeamHandoffLedger(cwd: string, taskId: string, teamRunId: string): {
    ok: boolean;
    reason: string | null;
    manifest: TeamHandoffManifest;
};
export declare function verifyTeamHandoffHistory(cwd: string, taskId: string, teamRunId: string): {
    ok: boolean;
    reason: string | null;
    manifest: TeamHandoffManifest;
};
export declare function verifyTeamHandoffDirectory(directory: string, taskId: string, teamRunId: string): {
    ok: boolean;
    reason: string | null;
    manifest: TeamHandoffManifest;
};
export declare function readTeamHandoffArtifacts(directory: string, manifest: TeamHandoffManifest): TeamRoleHandoffArtifact[];
export declare function renderTeamHandoffIndex(manifest: TeamHandoffManifest, artifacts: readonly TeamRoleHandoffArtifact[]): string;
