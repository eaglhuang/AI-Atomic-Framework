import type { EvidenceRecord, EvidenceSignalKind, EvidenceSignalScope } from '@ai-atomic-framework/core';
export type EvidencePatternTargetKind = 'atom' | 'atom-map' | 'host-local' | 'repo' | 'global' | 'unscoped';
export type EvidencePatternRecommendation = 'proposal-candidate' | 'observation-only';
export interface EvidencePatternDetectorThresholds {
    readonly minUsageCount: number;
    readonly minFrictionEvidence: number;
    readonly minConfidence: number;
}
export interface EvidencePatternDetectorInput {
    readonly evidence: readonly EvidenceRecord[];
    readonly window?: string;
    readonly thresholds?: Partial<EvidencePatternDetectorThresholds>;
    readonly generatedAt?: string;
    readonly detectorName?: string;
}
export interface EvidencePatternGroup {
    readonly groupId: string;
    readonly targetKind: EvidencePatternTargetKind;
    readonly targetId?: string;
    readonly signalKind: EvidenceSignalKind;
    readonly signalScope?: EvidenceSignalScope;
    readonly window: string;
    readonly usageCount: number;
    readonly frictionEvidenceCount: number;
    readonly positiveEvidenceCount: number;
    readonly neutralEvidenceCount: number;
    readonly matchedEvidenceIds: readonly string[];
    readonly rejectedEvidenceIds: readonly string[];
    readonly patternTags: readonly string[];
    readonly confidence: number;
    readonly recommendation: EvidencePatternRecommendation;
    readonly reasons: readonly string[];
}
export interface EvidencePatternDetectorReport {
    readonly schemaId: 'atm.evidencePatternDetectorReport';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly generatedAt: string;
    readonly detectorName: string;
    readonly window?: string;
    readonly thresholds: EvidencePatternDetectorThresholds;
    readonly summary: {
        readonly totalEvidence: number;
        readonly acceptedEvidence: number;
        readonly rejectedEvidence: number;
        readonly candidateGroups: number;
    };
    readonly groups: readonly EvidencePatternGroup[];
    readonly proposalCandidateGroupIds: readonly string[];
    readonly rejectedEvidenceIds: readonly string[];
    readonly empty: boolean;
}
export declare const defaultEvidencePatternDetectorThresholds: EvidencePatternDetectorThresholds;
export declare function detectEvidencePatterns(input: EvidencePatternDetectorInput): EvidencePatternDetectorReport;
