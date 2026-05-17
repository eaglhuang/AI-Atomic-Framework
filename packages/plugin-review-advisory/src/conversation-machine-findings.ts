import type {
  ConversationPatchDraftItem,
  ConversationPatchDraftReport
} from '@ai-atomic-framework/plugin-sdk';
import type {
  AdvisorySeverity,
  ReviewAdvisoryFinding
} from './index.ts';

export function mapConversationPatchDraftsToMachineFindings(report: ConversationPatchDraftReport): ReviewAdvisoryFinding[] {
  const findings: ReviewAdvisoryFinding[] = [];

  if (report.privacy.containsSensitiveInput && report.privacy.redactionReportPaths.length === 0) {
    findings.push({
      id: `finding.conversation.${sanitizeFindingSegment(report.sourceFindingsReport.transcriptId)}.missing-redaction-report`,
      severity: 'high',
      trigger: 'machine-finding',
      scope: 'proposal',
      action: 'request-human-review',
      routeHint: 'conversation-review.blocked.missing-redaction-report',
      message: 'Conversation-derived patch drafts considered sensitive input but no redaction report is attached.',
      evidenceRefs: [`${report.sourceFindingsReport.transcriptId}#privacy`],
      metadata: {
        source: 'conversation-patch-draft-bridge',
        gate: 'missingRedactionReport',
        containsSensitiveInput: true
      }
    });
  }

  for (const draft of report.drafts) {
    findings.push(mapDraftToMachineFinding(draft));
    findings.push(...checkDraftBlockingConditions(draft));
  }

  return dedupeFindings(findings);
}

function mapDraftToMachineFinding(draft: ConversationPatchDraftItem): ReviewAdvisoryFinding {
  const severity = severityForDraft(draft);
  return {
    id: `finding.conversation.${sanitizeFindingSegment(draft.draftId)}`,
    severity,
    trigger: 'machine-finding',
    scope: draft.draftKind === 'atom-patch' || draft.draftKind === 'atom-map-patch' ? 'proposal' : 'runtime',
    action: severity === 'high' ? 'request-human-review' : 'needs-review',
    routeHint: routeHintForDraft(draft),
    message: messageForDraft(draft),
    evidenceRefs: draft.evidenceRefs.length > 0 ? [...draft.evidenceRefs] : [draft.sourceFindingId],
    metadata: {
      source: 'conversation-patch-draft-bridge',
      sourceFindingId: draft.sourceFindingId,
      findingKind: draft.findingKind,
      draftKind: draft.draftKind,
      draftSurface: draft.draftSurface,
      operation: draft.operation,
      patchMode: draft.patchMode,
      requiresHumanReview: draft.requiresHumanReview,
      sourceTranscriptRefs: [...draft.sourceTranscriptRefs],
      skillId: draft.skillId,
      atomId: draft.atomId,
      atomMapId: draft.atomMapId
    }
  };
}

function checkDraftBlockingConditions(draft: ConversationPatchDraftItem): ReviewAdvisoryFinding[] {
  const findings: ReviewAdvisoryFinding[] = [];

  if (draft.evidenceRefs.length === 0) {
    findings.push(makeBlockingFinding({
      draft,
      suffix: 'missing-evidence-refs',
      gate: 'missingEvidenceRefs',
      message: 'Conversation-derived patch draft is missing evidence refs.',
      routeHint: 'conversation-review.blocked.missing-evidence-refs'
    }));
  }

  if (draft.sourceTranscriptRefs.length === 0) {
    findings.push(makeBlockingFinding({
      draft,
      suffix: 'missing-transcript-refs',
      gate: 'missingTranscriptRefs',
      message: 'Conversation-derived patch draft is missing source transcript refs.',
      routeHint: 'conversation-review.blocked.missing-transcript-refs'
    }));
  }

  if (
    draft.findingKind === 'style-format-correction' &&
    (draft.draftSurface !== 'host-local-overlay' || draft.upgradeProposalDraft !== undefined || draft.atomId !== undefined || draft.atomMapId !== undefined)
  ) {
    findings.push(makeBlockingFinding({
      draft,
      suffix: 'single-user-preference-downgrade',
      gate: 'targetSurfaceDowngrade',
      message: 'Style or format correction attempted to leave the host-local surface.',
      routeHint: 'conversation-review.blocked.single-user-preference-downgrade'
    }));
  }

  const requiresHumanReview = (draft as { readonly requiresHumanReview?: boolean }).requiresHumanReview;
  if ((draft.draftKind === 'skill-patch' || draft.draftKind === 'atom-patch' || draft.draftKind === 'atom-map-patch') && requiresHumanReview !== true) {
    findings.push(makeBlockingFinding({
      draft,
      suffix: 'missing-human-review',
      gate: 'breakingHumanReview',
      message: 'Skill or atom patch draft must require human review before any promotion path.',
      routeHint: 'conversation-review.blocked.missing-human-review'
    }));
  }

  const reversibility = (draft.upgradeProposalDraft as { readonly reversibility?: string } | undefined)?.reversibility;
  if (reversibility === 'breaking') {
    findings.push(makeBlockingFinding({
      draft,
      suffix: 'breaking-patch-human-review',
      gate: 'breakingHumanReview',
      message: 'Breaking conversation-derived atom patch must be routed to explicit human review.',
      routeHint: 'conversation-review.blocked.breaking-human-review'
    }));
  }

  if (draft.findingKind === 'stale-or-wrong-skill' && !draft.skillId) {
    findings.push(makeBlockingFinding({
      draft,
      suffix: 'missing-skill-id',
      gate: 'staleSkillRepair',
      message: 'Stale or wrong skill repair draft is missing skillId.',
      routeHint: 'conversation-review.blocked.stale-skill-missing-skill-id'
    }));
  }

  return findings;
}

function makeBlockingFinding(input: {
  readonly draft: ConversationPatchDraftItem;
  readonly suffix: string;
  readonly gate: string;
  readonly message: string;
  readonly routeHint: string;
}): ReviewAdvisoryFinding {
  return {
    id: `finding.conversation.${sanitizeFindingSegment(input.draft.draftId)}.${input.suffix}`,
    severity: 'high',
    trigger: 'machine-finding',
    scope: 'proposal',
    action: 'request-human-review',
    routeHint: input.routeHint,
    message: input.message,
    evidenceRefs: input.draft.evidenceRefs.length > 0 ? [...input.draft.evidenceRefs] : [input.draft.sourceFindingId],
    metadata: {
      source: 'conversation-patch-draft-bridge',
      gate: input.gate,
      sourceFindingId: input.draft.sourceFindingId,
      findingKind: input.draft.findingKind,
      draftKind: input.draft.draftKind,
      draftSurface: input.draft.draftSurface,
      sourceTranscriptRefs: [...input.draft.sourceTranscriptRefs]
    }
  };
}

function severityForDraft(draft: ConversationPatchDraftItem): AdvisorySeverity {
  if (draft.draftKind === 'atom-patch' || draft.findingKind === 'stale-or-wrong-skill') {
    return 'high';
  }
  if (draft.draftKind === 'skill-patch') {
    return 'medium';
  }
  if (draft.draftKind === 'host-local-overlay') {
    return 'low';
  }
  return 'info';
}

function routeHintForDraft(draft: ConversationPatchDraftItem): string {
  if (draft.draftKind === 'atom-patch') {
    return 'conversation-review.atom-patch.human-review-required';
  }
  if (draft.findingKind === 'stale-or-wrong-skill') {
    return 'conversation-review.stale-skill-repair.human-review-required';
  }
  if (draft.draftKind === 'skill-patch') {
    return 'conversation-review.skill-patch.human-review-required';
  }
  if (draft.draftKind === 'host-local-overlay') {
    return 'conversation-review.host-local-overlay.review-required';
  }
  return 'conversation-review.observation.monitor';
}

function messageForDraft(draft: ConversationPatchDraftItem): string {
  if (draft.draftKind === 'atom-patch') {
    return `Conversation finding ${draft.sourceFindingId} produced an atom patch draft that must enter ReviewAdvisory and human review.`;
  }
  if (draft.findingKind === 'stale-or-wrong-skill') {
    return `Conversation finding ${draft.sourceFindingId} produced a stale skill repair draft that must be reviewed before any skill edit.`;
  }
  if (draft.draftKind === 'skill-patch') {
    return `Conversation finding ${draft.sourceFindingId} produced a skill patch draft that must be reviewed before any skill edit.`;
  }
  if (draft.draftKind === 'host-local-overlay') {
    return `Conversation finding ${draft.sourceFindingId} remains host-local and must not be promoted to an atom contract.`;
  }
  return `Conversation finding ${draft.sourceFindingId} remains observation-only.`;
}

function dedupeFindings(findings: readonly ReviewAdvisoryFinding[]): ReviewAdvisoryFinding[] {
  const byId = new Map<string, ReviewAdvisoryFinding>();
  for (const finding of findings) {
    byId.set(finding.id, finding);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function sanitizeFindingSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .replace(/[.-]{2,}/g, '.');
  return sanitized || 'unknown';
}
