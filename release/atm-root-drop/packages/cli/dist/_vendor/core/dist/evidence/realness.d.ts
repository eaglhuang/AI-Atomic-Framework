export declare const evidenceRealnessLevels: readonly ["fixture", "unit", "command-smoke", "integration", "sealed-replay", "real-dogfood", "production-ledger"];
export type EvidenceRealness = typeof evidenceRealnessLevels[number];
export interface CommandBackedEvidenceProof {
    readonly command: string;
    readonly exitCode: number;
    readonly stdoutDigest: string;
    readonly stderrDigest: string;
}
export interface EvidenceRealnessObservation {
    readonly declaredRealness?: unknown;
    readonly commandProof?: CommandBackedEvidenceProof | null;
    readonly fixtureDigest?: string | null;
    readonly testId?: string | null;
    readonly integrationParticipants?: readonly string[];
    readonly sealedScenarioDigest?: string | null;
    readonly runnerDigest?: string | null;
    readonly workloadDigest?: string | null;
    readonly taskIds?: readonly string[];
    readonly actorIds?: readonly string[];
    readonly processIds?: readonly string[];
    readonly canonicalEventRefs?: readonly string[];
    readonly eventChainDigest?: string | null;
    readonly taskIdentityDigests?: readonly string[];
    readonly actorIdentityDigests?: readonly string[];
    readonly processIdentityDigests?: readonly string[];
    readonly syntheticSignals?: readonly ('fixed-pid' | 'fixed-timing' | 'fixed-cost' | 'self-reported-lifecycle')[];
    readonly productionLedgerRef?: string | null;
    readonly authorityDigest?: string | null;
}
export interface EvidenceRealnessAssessment {
    readonly declaredRealness: EvidenceRealness | null;
    readonly verifiedRealness: EvidenceRealness | null;
    readonly satisfiesDeclaredRealness: boolean;
    readonly reasons: readonly string[];
}
export declare function isEvidenceRealness(value: unknown): value is EvidenceRealness;
export declare function compareEvidenceRealness(left: EvidenceRealness, right: EvidenceRealness): number;
export declare function evidenceMeetsRequiredRealness(verified: EvidenceRealness | null, required: EvidenceRealness): boolean;
export declare function assessEvidenceRealness(observation: EvidenceRealnessObservation): EvidenceRealnessAssessment;
