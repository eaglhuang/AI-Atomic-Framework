import type { EvidenceSignalKind, EvidenceSignalScope } from '@ai-atomic-framework/core';
import type {
  ConversationReviewFinding,
  ConversationReviewFindingKind,
  ConversationReviewFindingsReport,
  ConversationReviewPatchDraft,
  ConversationReviewRecommendation,
  ConversationReviewRecommendedTarget
} from './conversation-review-finding';

export interface ConversationTranscriptTurn {
  readonly turnId: string;
  readonly role: 'user' | 'agent' | 'system';
  readonly content: string;
  readonly atomId?: string;
  readonly atomMapId?: string;
  readonly skillId?: string;
  readonly evidenceRefs?: readonly string[];
  readonly confidence?: number;
  readonly occurredAt?: string;
}

export interface ConversationTranscript {
  readonly schemaId: 'atm.conversationTranscript';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly transcriptId: string;
  readonly sessionId?: string;
  readonly window?: string;
  readonly redacted: true;
  readonly containsSensitiveInput: boolean;
  readonly artifactPaths: readonly string[];
  readonly redactionReportPaths?: readonly string[];
  readonly turns: readonly ConversationTranscriptTurn[];
}

export interface ConversationTranscriptReviewInput {
  readonly transcript: ConversationTranscript;
  readonly generatedAt?: string;
  readonly reviewerName?: string;
  readonly window?: string;
}

export type ConversationTranscriptReviewErrorCode =
  | 'unredacted-transcript'
  | 'sensitive-without-redaction-report';

export class ConversationTranscriptReviewError extends Error {
  readonly code: ConversationTranscriptReviewErrorCode;
  readonly transcriptId: string;

  constructor(code: ConversationTranscriptReviewErrorCode, transcriptId: string, message: string) {
    super(message);
    this.name = 'ConversationTranscriptReviewError';
    this.code = code;
    this.transcriptId = transcriptId;
  }
}

export const conversationTranscriptReviewerName = 'deterministic-conversation-transcript-reviewer';

const findingRules: readonly {
  readonly kind: ConversationReviewFindingKind;
  readonly signalKind: EvidenceSignalKind;
  readonly match: RegExp;
  readonly target: (turn: ConversationTranscriptTurn) => {
    readonly signalScope: EvidenceSignalScope;
    readonly recommendedTarget: ConversationReviewRecommendedTarget;
    readonly recommendation: ConversationReviewRecommendation;
    readonly patchDraft: ConversationReviewPatchDraft;
  };
}[] = [
  {
    kind: 'style-format-correction',
    signalKind: 'user-correction',
    match: /\b(shorter|concise|format|checklist|bullet|style)\b/i,
    target: () => ({
      signalScope: 'host-local',
      recommendedTarget: 'host-local-overlay',
      recommendation: 'draft-host-local-preference',
      patchDraft: makePatchDraft('host-local-overlay', 'Draft a host-local output-shape preference; do not promote to an atom contract.')
    })
  },
  {
    kind: 'workflow-adjustment',
    signalKind: 'user-correction',
    match: /\b(missing preflight|missed step|wrong order|workflow|step order|forgot to|missing step)\b/i,
    target: (turn) => turn.atomId
      ? {
          signalScope: 'atom',
          recommendedTarget: 'atom-patch-draft',
          recommendation: 'draft-atom-patch',
          patchDraft: makePatchDraft('atom-patch', 'Draft an atom evolution proposal that adds the missing workflow step.')
        }
      : {
          signalScope: 'repo',
          recommendedTarget: 'skill-patch-draft',
          recommendation: 'draft-skill-patch',
          patchDraft: makePatchDraft('skill-patch', 'Draft a workflow repair note for the affected skill or procedure.', turn.skillId)
        }
  },
  {
    kind: 'non-trivial-debug-path',
    signalKind: 'novel-technique',
    match: /\b(debug path|root cause|failed attempts|final fix|reusable debugging|after .* failed)\b/i,
    target: (turn) => ({
      signalScope: 'repo',
      recommendedTarget: 'skill-patch-draft',
      recommendation: 'draft-skill-patch',
      patchDraft: makePatchDraft('skill-patch', 'Draft a reusable troubleshooting path as a skill pitfall note.', turn.skillId)
    })
  },
  {
    kind: 'stale-or-wrong-skill',
    signalKind: 'loaded-but-wrong',
    match: /\b(stale skill|skill .*outdated|loaded skill.*wrong|wrong command sequence|outdated command)\b/i,
    target: (turn) => ({
      signalScope: 'repo',
      recommendedTarget: 'skill-patch-draft',
      recommendation: 'draft-skill-patch',
      patchDraft: makePatchDraft('skill-patch', 'Draft a skill repair proposal for the stale command sequence.', turn.skillId)
    })
  }
];

export function reviewConversationTranscript(input: ConversationTranscriptReviewInput): ConversationReviewFindingsReport {
  const transcript = input.transcript;
  if (transcript.redacted !== true) {
    throw new ConversationTranscriptReviewError(
      'unredacted-transcript',
      transcript.transcriptId,
      `conversation transcript "${transcript.transcriptId}" must be redacted before review`
    );
  }

  const redactionReportPaths = transcript.redactionReportPaths ?? [];
  if (transcript.containsSensitiveInput && redactionReportPaths.length === 0) {
    throw new ConversationTranscriptReviewError(
      'sensitive-without-redaction-report',
      transcript.transcriptId,
      `conversation transcript "${transcript.transcriptId}" contains sensitive input but no redaction report was provided`
    );
  }

  const findings: ConversationReviewFinding[] = [];
  for (const turn of transcript.turns) {
    if (turn.role !== 'user') continue;
    for (const rule of findingRules) {
      if (!rule.match.test(turn.content)) continue;
      const target = rule.target(turn);
      const evidenceRefs = turn.evidenceRefs?.length
        ? [...turn.evidenceRefs]
        : [createEvidenceRef(transcript, rule.kind, turn.turnId)];
      const finding: ConversationReviewFinding = {
        findingId: createFindingId(transcript.transcriptId, rule.kind, turn.turnId),
        findingKind: rule.kind,
        signalKind: rule.signalKind,
        signalScope: target.signalScope,
        ...(target.signalScope !== 'host-local' && turn.atomId ? { atomId: turn.atomId } : {}),
        ...(target.signalScope !== 'host-local' && turn.atomMapId ? { atomMapId: turn.atomMapId } : {}),
        ...(turn.skillId ? { skillId: turn.skillId } : {}),
        confidence: Number((turn.confidence ?? 0.8).toFixed(4)),
        sourceTranscriptRefs: [`${transcript.transcriptId}#${turn.turnId}`],
        evidenceRefs,
        recommendedTarget: target.recommendedTarget,
        recommendation: target.recommendation,
        rationale: createRationale(rule.kind, turn),
        patchDraft: target.patchDraft
      };
      findings.push(finding);
      break;
    }
  }

  findings.sort((left, right) => left.findingId.localeCompare(right.findingId));

  const findingKinds = [...new Set(findings.map((finding) => finding.findingKind))].sort();
  const draftCount = findings.filter((finding) => finding.recommendation !== 'observation-only').length;
  const observationCount = findings.length - draftCount;

  return {
    schemaId: 'atm.conversationReviewFindingsReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Deterministic transcript reviewer generated conversation review findings.'
    },
    generatedAt: input.generatedAt ?? '1970-01-01T00:00:00.000Z',
    reviewerName: input.reviewerName ?? conversationTranscriptReviewerName,
    ...(input.window ?? transcript.window ? { window: input.window ?? transcript.window } : {}),
    sourceTranscript: {
      transcriptId: transcript.transcriptId,
      ...(transcript.sessionId ? { sessionId: transcript.sessionId } : {}),
      artifactPaths: transcript.artifactPaths,
      ...(redactionReportPaths.length ? { redactionReportPaths } : {})
    },
    privacy: {
      redacted: true,
      containsSensitiveInput: transcript.containsSensitiveInput,
      redactionReportPaths
    },
    summary: {
      totalFindings: findings.length,
      draftCount,
      observationCount,
      findingKinds
    },
    findings,
    draftOnly: {
      appliesAutomatically: false,
      mutatesRegistry: false,
      mutatesSkillFiles: false,
      requiresHumanReview: true
    }
  };
}

function makePatchDraft(
  draftKind: ConversationReviewPatchDraft['draftKind'],
  summary: string,
  skillId?: string
): ConversationReviewPatchDraft {
  return {
    draftKind,
    patchMode: 'dry-run',
    mutatesFiles: false,
    mutatesRegistry: false,
    requiresHumanReview: true,
    summary,
    ...(draftKind === 'skill-patch' && skillId ? { patchFiles: [`.agents/skills/${skillId}/SKILL.md`] } : {})
  };
}

function createFindingId(transcriptId: string, kind: ConversationReviewFindingKind, turnId: string): string {
  return `finding.transcript.${sanitizeIdentifier(transcriptId)}.${kind}.${sanitizeIdentifier(turnId)}`;
}

function createEvidenceRef(transcript: ConversationTranscript, kind: ConversationReviewFindingKind, turnId: string): string {
  return `evidence.transcript.${sanitizeIdentifier(transcript.sessionId ?? transcript.transcriptId)}.${kind}.${sanitizeIdentifier(turnId)}`;
}

function createRationale(kind: ConversationReviewFindingKind, turn: ConversationTranscriptTurn): string {
  switch (kind) {
    case 'style-format-correction':
      return `User requested a style or format change: ${turn.content}`;
    case 'workflow-adjustment':
      return `User corrected a workflow step or order: ${turn.content}`;
    case 'non-trivial-debug-path':
      return `Conversation captured a reusable debugging path: ${turn.content}`;
    case 'stale-or-wrong-skill':
      return `User indicated a loaded skill or command sequence was wrong: ${turn.content}`;
  }
}

function sanitizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unspecified';
}
