export interface EvidencePatternDetectorGroupLike {
    readonly groupId: string;
    readonly targetKind: 'atom' | 'atom-map' | 'host-local' | 'repo' | 'global' | 'unscoped';
    readonly targetId?: string;
    readonly signalKind: string;
    readonly signalScope?: 'host-local' | 'repo' | 'atom' | 'atom-map' | 'global';
    readonly window: string;
    readonly usageCount: number;
    readonly frictionEvidenceCount: number;
    readonly positiveEvidenceCount: number;
    readonly neutralEvidenceCount: number;
    readonly matchedEvidenceIds: readonly string[];
    readonly rejectedEvidenceIds: readonly string[];
    readonly patternTags: readonly string[];
    readonly confidence: number;
    readonly recommendation: 'proposal-candidate' | 'observation-only';
    readonly reasons: readonly string[];
}
export interface EvidencePatternDetectorReportLike {
    readonly schemaId: 'atm.evidencePatternDetectorReport';
    readonly specVersion: '0.1.0';
    readonly migration?: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly generatedAt: string;
    readonly detectorName: string;
    readonly window?: string;
    readonly thresholds: {
        readonly minUsageCount: number;
        readonly minFrictionEvidence: number;
        readonly minConfidence: number;
    };
    readonly summary: {
        readonly totalEvidence: number;
        readonly acceptedEvidence: number;
        readonly rejectedEvidence: number;
        readonly candidateGroups: number;
    };
    readonly groups: readonly EvidencePatternDetectorGroupLike[];
    readonly proposalCandidateGroupIds: readonly string[];
    readonly rejectedEvidenceIds: readonly string[];
    readonly empty: boolean;
}
export interface EvolutionScanInputReport {
    readonly path: string;
    readonly document: EvidencePatternDetectorReportLike;
}
export interface EvolutionScanRequest {
    readonly repositoryRoot: string;
    readonly detectorReports: readonly EvolutionScanInputReport[];
    readonly proposedBy?: string;
    readonly proposedAt?: string;
    readonly dryRun?: boolean;
}
export interface EvolutionScanReportSummary {
    readonly path: string;
    readonly detectorName: string;
    readonly candidateGroupCount: number;
    readonly proposalCandidateGroupIds: readonly string[];
    readonly empty: boolean;
}
export interface EvolutionScanObservation {
    readonly detectorReportCount: number;
    readonly candidateGroupCount: number;
    readonly proposalDraftCount: number;
    readonly skippedGroupIds: readonly string[];
    readonly notes: readonly string[];
}
export interface EvolutionProposalInputRef {
    readonly kind: 'evolution-evidence';
    readonly path: string;
    readonly schemaId: 'atm.evidencePatternDetectorReport';
    readonly reportId?: string;
    readonly summary: string;
}
export interface EvolutionProposalGateResult {
    readonly passed: boolean;
    readonly reportId: string;
    readonly reportPath: string;
    readonly summary: string;
}
export interface EvolutionProposalDraft {
    readonly schemaId: 'atm.upgradeProposal';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'additive';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly proposalId: string;
    readonly atomId: string;
    readonly fromVersion: string;
    readonly toVersion: string;
    readonly lifecycleMode: 'evolution';
    readonly behaviorId: 'behavior.evolve';
    readonly target: {
        readonly kind: 'atom';
    };
    readonly decompositionDecision: 'atom-bump';
    readonly proposalSource: 'evidence-driven';
    readonly targetSurface: 'atom-spec';
    readonly baseAtomVersion: string;
    readonly baseEvidenceWatermark: string;
    readonly reversibility: 'rollback-safe';
    readonly evidenceGate: {
        readonly requiredSignals: readonly string[];
        readonly matchedEvidenceIds: readonly string[];
        readonly rejectedEvidenceIds: readonly string[];
        readonly notes: string;
    };
    readonly reviewTemplate: string;
    readonly automatedGates: {
        readonly nonRegression: EvolutionProposalGateResult;
        readonly qualityComparison: EvolutionProposalGateResult;
        readonly registryCandidate: EvolutionProposalGateResult;
        readonly allPassed: boolean;
        readonly blockedGateNames: readonly string[];
    };
    readonly humanReview: 'pending';
    readonly status: 'pending' | 'blocked';
    readonly inputs: readonly EvolutionProposalInputRef[];
    readonly proposedBy: string;
    readonly proposedAt: string;
}
export interface EvolutionProposalDraftBundleItem {
    readonly groupIds: readonly string[];
    readonly detectorReportPaths: readonly string[];
    readonly proposal: EvolutionProposalDraft;
}
export interface EvolutionScanReport {
    readonly schemaId: 'atm.evolutionScanReport';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly scanId: string;
    readonly generatedAt: string;
    readonly repositoryRoot: string;
    readonly scanMode: 'dry-run';
    readonly detectorReports: readonly EvolutionScanReportSummary[];
    readonly observation: EvolutionScanObservation;
    readonly proposalDrafts: readonly EvolutionProposalDraftBundleItem[];
    readonly empty: boolean;
}
export declare function scanEvidencePatternReports(request: EvolutionScanRequest): EvolutionScanReport;
