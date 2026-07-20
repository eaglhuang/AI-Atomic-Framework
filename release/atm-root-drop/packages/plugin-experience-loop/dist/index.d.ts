import type { ContextSummaryRecord, EvidenceRecord } from '@ai-atomic-framework/core';
import type { AtomBehavior, AtomLifecycleModeValue, BehaviorRegistry, MemoryScope } from '@ai-atomic-framework/plugin-sdk';
export declare const pluginExperienceLoopPackage: {
    readonly packageName: "@ai-atomic-framework/plugin-experience-loop";
    readonly packageRole: "experience-loop-learning-artifacts";
    readonly packageVersion: "0.0.0";
};
export interface ExperienceLoopThresholds {
    readonly extractSkillConfidenceThreshold: number;
    readonly skillAmendWindow: number;
    readonly skillAmendFailureCount: number;
    readonly memoryNudgePatternCount: number;
}
export declare const defaultExperienceLoopThresholds: ExperienceLoopThresholds;
export interface ExperienceExtractionInput {
    readonly sourceTaskId: string;
    readonly evidence: readonly EvidenceRecord[];
    readonly contextSummary?: ContextSummaryRecord | string;
    readonly diffSummary?: string;
    readonly proposedName?: string;
    readonly proposedApplyTo?: readonly string[];
    readonly now?: string;
}
export interface ExperienceReviewRoute {
    readonly required: boolean;
    readonly route: readonly ['plugin-review-advisory', 'plugin-human-review'];
}
export interface SkillCandidate {
    readonly schemaVersion: 'atm.skillCandidate.v0.1';
    readonly id: string;
    readonly sourceTaskId: string;
    readonly proposedName: string;
    readonly proposedDescription: string;
    readonly proposedApplyTo: readonly string[];
    readonly proposedSteps: readonly string[];
    readonly confidence: number;
    readonly patternTags: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly lifecycleMode: Extract<AtomLifecycleModeValue, 'birth'>;
    readonly status: 'candidate';
    readonly generatedAt: string;
    readonly review: ExperienceReviewRoute;
}
export interface SkillCandidateReport {
    readonly ok: boolean;
    readonly candidate: SkillCandidate;
    readonly threshold: number;
    readonly messages: readonly string[];
}
export type ExperienceProposalKind = 'skill-candidate' | 'skill-amendment' | 'memory-nudge';
export interface ExperienceHumanReviewProposalSnapshot {
    readonly proposalId: string;
    readonly atomId: string;
    readonly fromVersion: string;
    readonly toVersion: string;
    readonly decompositionDecision: 'atom-extract' | 'atom-bump';
    readonly automatedGates: {
        readonly allPassed: boolean;
        readonly blockedGateNames: readonly string[];
    };
    readonly status: 'pending';
    readonly proposedAt: string;
    readonly experienceKind: ExperienceProposalKind;
    readonly reviewRoute: readonly ['plugin-review-advisory', 'plugin-human-review'];
    readonly candidate: SkillCandidate | SkillAmendmentProposal | MemoryNudge;
}
export interface SkillUsageRecord {
    readonly ok: boolean;
    readonly summary?: string;
    readonly evidenceRefs?: readonly string[];
    readonly patternTags?: readonly string[];
}
export interface SkillAmendmentInput {
    readonly targetSkillId: string;
    readonly triggeringEvidence: readonly EvidenceRecord[];
    readonly usageHistory: readonly SkillUsageRecord[];
    readonly rationale?: string;
    readonly now?: string;
}
export interface SkillAmendmentProposal {
    readonly schemaVersion: 'atm.skillAmendmentProposal.v0.1';
    readonly id: string;
    readonly targetSkillId: string;
    readonly rationale: string;
    readonly proposedChangeSummary: string;
    readonly confidence: number;
    readonly evidenceRefs: readonly string[];
    readonly lifecycleMode: Extract<AtomLifecycleModeValue, 'evolution'>;
    readonly status: 'candidate' | 'suppressed';
    readonly generatedAt: string;
}
export interface MemoryNudgeInput {
    readonly workItemId: string;
    readonly evidence: readonly EvidenceRecord[];
    readonly scope?: MemoryScope;
    readonly now?: string;
}
export interface MemoryNudge {
    readonly schemaVersion: 'atm.memoryNudge.v0.1';
    readonly id: string;
    readonly workItemId: string;
    readonly scope: MemoryScope;
    readonly suggestedKey: string;
    readonly suggestedContent: string;
    readonly rationale: string;
    readonly evidenceRefs: readonly string[];
    readonly generatedAt: string;
}
export declare function extractSkillCandidate(input: ExperienceExtractionInput, thresholds?: ExperienceLoopThresholds): SkillCandidateReport;
export declare function createExperienceHumanReviewProposalSnapshot(input: {
    readonly kind: ExperienceProposalKind;
    readonly atomId: string;
    readonly candidate: SkillCandidate | SkillAmendmentProposal | MemoryNudge;
    readonly automatedGatePassed: boolean;
    readonly blockedGateNames?: readonly string[];
}): ExperienceHumanReviewProposalSnapshot;
export declare function createSkillAmendmentProposal(input: SkillAmendmentInput, thresholds?: ExperienceLoopThresholds): SkillAmendmentProposal;
export declare function createMemoryNudges(input: MemoryNudgeInput, thresholds?: ExperienceLoopThresholds): readonly MemoryNudge[];
export declare const experienceExtractSkillBehavior: AtomBehavior;
export declare const experienceSkillAmendBehavior: AtomBehavior;
export declare const experienceMemoryNudgeBehavior: AtomBehavior;
export declare const experienceLoopBehaviors: readonly AtomBehavior[];
export declare function registerExperienceLoopBehaviors(registry: Pick<BehaviorRegistry, 'register'>): void;
