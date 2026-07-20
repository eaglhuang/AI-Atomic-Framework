import type { ConversationReviewFindingKind, ConversationReviewFindingsReport, ConversationReviewPatchDraftKind } from './conversation-review-finding';
export declare const conversationPatchDraftBridgeName = "deterministic-conversation-patch-draft-bridge";
export type ConversationPatchDraftSurface = 'host-local-overlay' | 'skill' | 'atom-spec' | 'atom-map' | 'observation';
export type ConversationPatchDraftOperation = 'record-host-local-preference' | 'repair-workflow' | 'capture-debug-path' | 'repair-stale-skill' | 'observe-only';
export interface ConversationPatchDraftBridgeInput {
    readonly findingsReport: ConversationReviewFindingsReport;
    readonly generatedAt?: string;
    readonly bridgeName?: string;
    readonly sourceReportPath?: string;
    readonly proposedBy?: string;
    readonly atomVersionById?: Readonly<Record<string, string>>;
}
export interface ConversationPatchDraftReport {
    readonly schemaId: 'atm.conversationPatchDraftReport';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly generatedAt: string;
    readonly bridgeName: string;
    readonly sourceFindingsReport: {
        readonly schemaId: 'atm.conversationReviewFindingsReport';
        readonly artifactPath?: string;
        readonly transcriptId: string;
        readonly sessionId?: string;
        readonly findingIds: readonly string[];
    };
    readonly privacy: {
        readonly redacted: true;
        readonly containsSensitiveInput: boolean;
        readonly redactionReportPaths: readonly string[];
    };
    readonly summary: {
        readonly totalFindings: number;
        readonly totalDrafts: number;
        readonly hostLocalDraftCount: number;
        readonly skillDraftCount: number;
        readonly atomDraftCount: number;
        readonly atomMapDraftCount: number;
        readonly observationCount: number;
        readonly humanReviewRequiredCount: number;
    };
    readonly drafts: readonly ConversationPatchDraftItem[];
    readonly draftOnly: {
        readonly appliesAutomatically: false;
        readonly mutatesFiles: false;
        readonly mutatesRegistry: false;
        readonly mutatesSkillFiles: false;
        readonly requiresHumanReview: true;
    };
}
export interface ConversationPatchDraftItem {
    readonly draftId: string;
    readonly sourceFindingId: string;
    readonly findingKind: ConversationReviewFindingKind;
    readonly draftKind: ConversationReviewPatchDraftKind;
    readonly draftSurface: ConversationPatchDraftSurface;
    readonly operation: ConversationPatchDraftOperation;
    readonly patchMode: 'dry-run';
    readonly appliesAutomatically: false;
    readonly mutatesFiles: false;
    readonly mutatesRegistry: false;
    readonly mutatesSkillFiles: false;
    readonly requiresHumanReview: true;
    readonly summary: string;
    readonly rationale: string;
    readonly sourceTranscriptRefs: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly patchFiles?: readonly string[];
    readonly skillId?: string;
    readonly atomId?: string;
    readonly atomMapId?: string;
    readonly upgradeProposalDraft?: ConversationAtomUpgradeProposalDraft;
    readonly notes: readonly string[];
}
export interface ConversationAtomUpgradeProposalDraft {
    readonly schemaId: 'atm.upgradeProposal';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'additive';
        readonly fromVersion: string;
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
    readonly reviewTemplate: 'review.template.atom-bump';
    readonly automatedGates: {
        readonly nonRegression: ConversationPatchDraftGateResult;
        readonly qualityComparison: ConversationPatchDraftGateResult;
        readonly registryCandidate: ConversationPatchDraftGateResult;
        readonly staleProposal: ConversationPatchDraftGateResult;
        readonly privacy: ConversationPatchDraftGateResult;
        readonly allPassed: true;
        readonly blockedGateNames: readonly [];
    };
    readonly humanReview: 'pending';
    readonly status: 'pending';
    readonly inputs: readonly ConversationPatchDraftProposalInput[];
    readonly proposedBy: string;
    readonly proposedAt: string;
}
export interface ConversationPatchDraftGateResult {
    readonly passed: true;
    readonly reportId: string;
    readonly reportPath: string;
    readonly summary: string;
}
export interface ConversationPatchDraftProposalInput {
    readonly kind: 'evolution-evidence' | 'redaction-report';
    readonly path: string;
    readonly schemaId: string;
    readonly reportId?: string;
    readonly summary: string;
}
export declare function draftConversationPatches(input: ConversationPatchDraftBridgeInput): ConversationPatchDraftReport;
