import type {
  EvidenceSignalKind,
  EvidenceSignalScope
} from '@ai-atomic-framework/core';

export const conversationReviewFindingKinds = [
  'style-format-correction',
  'workflow-adjustment',
  'non-trivial-debug-path',
  'stale-or-wrong-skill'
] as const;

export type ConversationReviewFindingKind = typeof conversationReviewFindingKinds[number];

export type ConversationReviewRecommendedTarget =
  | 'host-local-overlay'
  | 'skill-patch-draft'
  | 'atom-patch-draft'
  | 'atom-map-patch-draft'
  | 'observation-only';

export type ConversationReviewRecommendation =
  | 'draft-host-local-preference'
  | 'draft-skill-patch'
  | 'draft-atom-patch'
  | 'draft-atom-map-patch'
  | 'observation-only';

export type ConversationReviewPatchDraftKind =
  | 'host-local-overlay'
  | 'skill-patch'
  | 'atom-patch'
  | 'atom-map-patch'
  | 'observation';

export interface ConversationReviewPatchDraft {
  readonly draftKind: ConversationReviewPatchDraftKind;
  readonly patchMode: 'dry-run';
  readonly mutatesFiles: false;
  readonly mutatesRegistry: false;
  readonly requiresHumanReview: true;
  readonly summary: string;
  readonly patchFiles?: readonly string[];
}

export interface ConversationReviewFinding {
  readonly findingId: string;
  readonly findingKind: ConversationReviewFindingKind;
  readonly signalKind: EvidenceSignalKind;
  readonly signalScope: EvidenceSignalScope;
  readonly atomId?: string;
  readonly atomMapId?: string;
  readonly skillId?: string;
  readonly confidence: number;
  readonly sourceTranscriptRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly recommendedTarget: ConversationReviewRecommendedTarget;
  readonly recommendation: ConversationReviewRecommendation;
  readonly rationale: string;
  readonly patchDraft: ConversationReviewPatchDraft;
}

export interface ConversationReviewFindingsReport {
  readonly schemaId: 'atm.conversationReviewFindingsReport';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly generatedAt: string;
  readonly reviewerName: string;
  readonly window?: string;
  readonly sourceTranscript: {
    readonly transcriptId: string;
    readonly sessionId?: string;
    readonly artifactPaths: readonly string[];
    readonly redactionReportPaths?: readonly string[];
  };
  readonly privacy: {
    readonly redacted: true;
    readonly containsSensitiveInput: boolean;
    readonly redactionReportPaths: readonly string[];
  };
  readonly summary: {
    readonly totalFindings: number;
    readonly draftCount: number;
    readonly observationCount: number;
    readonly findingKinds: readonly ConversationReviewFindingKind[];
  };
  readonly findings: readonly ConversationReviewFinding[];
  readonly draftOnly: {
    readonly appliesAutomatically: false;
    readonly mutatesRegistry: false;
    readonly mutatesSkillFiles: false;
    readonly requiresHumanReview: true;
  };
}
