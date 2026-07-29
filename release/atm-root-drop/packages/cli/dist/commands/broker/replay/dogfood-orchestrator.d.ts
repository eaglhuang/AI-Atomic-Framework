export interface Plan3DogfoodOrchestratorInput {
    readonly cwd: string;
    readonly requiredIntersection: readonly string[];
    readonly participantTaskIds?: readonly string[];
}
export interface Plan3DogfoodOrchestratorEvidence {
    readonly schemaId: 'atm.plan3DogfoodOrchestratorEvidence.v1';
    readonly taskIds: readonly string[];
    readonly actorIds: readonly string[];
    readonly canonical: {
        readonly root: string;
        readonly baseDigest: string;
        readonly headDigest: string;
        readonly buildDigest: string;
    };
    readonly safeComposeCell: Plan3DogfoodCell;
    readonly fallbackCell: Plan3DogfoodCell;
    readonly steward: {
        readonly neutral: boolean;
        readonly canonicalWriteCount: number;
        readonly attributionTaskIds: readonly string[];
        readonly sharedCommitDigest: string;
    };
    readonly terminalAuthorizationCensus: {
        readonly activeAuthorizationCount: number;
        readonly manualInterventionCount: number;
        readonly emergencyBypassCount: number;
    };
    readonly dashboardDigest: string;
    readonly artifactDigests: readonly Plan3ArtifactDigest[];
    readonly digest: string;
}
export interface Plan3DogfoodCell {
    readonly cellId: string;
    readonly selectedTaskIds: readonly string[];
    readonly composeBatchId: string;
    readonly serializabilityProofDigest: string;
    readonly candidateDigest: string;
    readonly validatorUnionDigest: string;
    readonly canonicalWriteCount: number;
    readonly waitedMs: number;
    readonly releaseCondition: string;
    readonly successorWakeup: boolean;
    readonly verdict: 'pass' | 'fail-closed' | 'inconclusive';
}
export interface Plan3ArtifactDigest {
    readonly taskId: string;
    readonly path: string;
    readonly digest: string;
}
export declare function buildPlan3DogfoodOrchestratorEvidence(input: Plan3DogfoodOrchestratorInput): Plan3DogfoodOrchestratorEvidence;
