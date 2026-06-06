import { createHash } from 'node:crypto';
import type { ContextSummaryRecord, EvidenceRecord } from '@ai-atomic-framework/core';
import type { AtomBehavior, AtomBehaviorOutput, AtomLifecycleModeValue, BehaviorRegistry, MemoryScope } from '@ai-atomic-framework/plugin-sdk';

export const pluginExperienceLoopPackage = {
  packageName: '@ai-atomic-framework/plugin-experience-loop',
  packageRole: 'experience-loop-learning-artifacts',
  packageVersion: '0.0.0'
} as const;

export interface ExperienceLoopThresholds {
  readonly extractSkillConfidenceThreshold: number;
  readonly skillAmendWindow: number;
  readonly skillAmendFailureCount: number;
  readonly memoryNudgePatternCount: number;
}

export const defaultExperienceLoopThresholds: ExperienceLoopThresholds = Object.freeze({
  extractSkillConfidenceThreshold: 0.6,
  skillAmendWindow: 10,
  skillAmendFailureCount: 3,
  memoryNudgePatternCount: 3
});

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

type DetectorPattern = {
  readonly tag: string;
  readonly terms: readonly string[];
};

const detectorPatterns: readonly DetectorPattern[] = Object.freeze([
  { tag: 'missing-adapter', terms: ['adapter missing', 'missing adapter', 'adapter boundary'] },
  { tag: 'validation-gap', terms: ['validation gap', 'missing validation', 'no validator'] },
  { tag: 'review-needed', terms: ['review required', 'needs review', 'human review'] },
  { tag: 'recurring-error', terms: ['repeated', 'recurring', 'again'] },
  { tag: 'contract-drift', terms: ['contract drift', 'schema drift', 'registry drift'] }
]);

export function extractSkillCandidate(
  input: ExperienceExtractionInput,
  thresholds: ExperienceLoopThresholds = defaultExperienceLoopThresholds
): SkillCandidateReport {
  const sourceTaskId = normalizeRequiredText(input.sourceTaskId, 'sourceTaskId');
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const patternTags = collectPatternTags(evidence);
  const evidenceRefs = collectEvidenceRefs(evidence);
  const generatedAt = input.now ?? new Date().toISOString();
  const proposedName = normalizeSkillName(input.proposedName ?? inferSkillName(sourceTaskId, patternTags));
  const confidence = calculateExtractionConfidence(evidence, patternTags, input.contextSummary, input.diffSummary);
  const candidate: SkillCandidate = {
    schemaVersion: 'atm.skillCandidate.v0.1',
    id: createStableId('skill-candidate', { sourceTaskId, patternTags, evidenceRefs, proposedName }),
    sourceTaskId,
    proposedName,
    proposedDescription: createSkillDescription(sourceTaskId, patternTags),
    proposedApplyTo: normalizeApplyTo(input.proposedApplyTo),
    proposedSteps: createProposedSteps(evidence, input.contextSummary),
    confidence,
    patternTags,
    evidenceRefs,
    lifecycleMode: 'birth',
    status: 'candidate',
    generatedAt,
    review: {
      required: true,
      route: ['plugin-review-advisory', 'plugin-human-review']
    }
  };

  return {
    ok: confidence >= thresholds.extractSkillConfidenceThreshold,
    candidate,
    threshold: thresholds.extractSkillConfidenceThreshold,
    messages: confidence >= thresholds.extractSkillConfidenceThreshold
      ? ['Skill candidate crossed the extraction threshold.']
      : ['Skill candidate generated below the extraction threshold; keep it advisory.']
  };
}

export function createExperienceHumanReviewProposalSnapshot(input: {
  readonly kind: ExperienceProposalKind;
  readonly atomId: string;
  readonly candidate: SkillCandidate | SkillAmendmentProposal | MemoryNudge;
  readonly automatedGatePassed: boolean;
  readonly blockedGateNames?: readonly string[];
}): ExperienceHumanReviewProposalSnapshot {
  const atomId = normalizeRequiredText(input.atomId, 'atomId');
  const candidateId = 'id' in input.candidate ? input.candidate.id : createStableId('experience-candidate', input.candidate);
  return {
    proposalId: `experience.${candidateId}`,
    atomId,
    fromVersion: input.kind === 'skill-amendment' ? '0.1.0' : '0.0.0',
    toVersion: '0.1.0',
    decompositionDecision: input.kind === 'skill-amendment' ? 'atom-bump' : 'atom-extract',
    automatedGates: {
      allPassed: input.automatedGatePassed,
      blockedGateNames: input.automatedGatePassed ? [] : [...(input.blockedGateNames ?? ['experience-loop-threshold'])]
    },
    status: 'pending',
    proposedAt: 'generatedAt' in input.candidate ? input.candidate.generatedAt : new Date().toISOString(),
    experienceKind: input.kind,
    reviewRoute: ['plugin-review-advisory', 'plugin-human-review'],
    candidate: input.candidate
  };
}

export function createSkillAmendmentProposal(
  input: SkillAmendmentInput,
  thresholds: ExperienceLoopThresholds = defaultExperienceLoopThresholds
): SkillAmendmentProposal {
  const targetSkillId = normalizeRequiredText(input.targetSkillId, 'targetSkillId');
  const usageWindow = input.usageHistory.slice(-thresholds.skillAmendWindow);
  const failedUsages = usageWindow.filter((usageRecord) => usageRecord.ok === false);
  const triggeringTags = collectPatternTags(input.triggeringEvidence);
  const evidenceRefs = collectEvidenceRefs(input.triggeringEvidence);
  const confidence = clampConfidence(0.4 + failedUsages.length * 0.08 + triggeringTags.length * 0.04);
  const status = failedUsages.length >= thresholds.skillAmendFailureCount ? 'candidate' : 'suppressed';

  return {
    schemaVersion: 'atm.skillAmendmentProposal.v0.1',
    id: createStableId('skill-amendment', { targetSkillId, triggeringTags, evidenceRefs, status }),
    targetSkillId,
    rationale: input.rationale ?? `Observed ${failedUsages.length} failed usage records in the configured window.`,
    proposedChangeSummary: createAmendmentSummary(targetSkillId, triggeringTags),
    confidence,
    evidenceRefs,
    lifecycleMode: 'evolution',
    status,
    generatedAt: input.now ?? new Date().toISOString()
  };
}

export function createMemoryNudges(
  input: MemoryNudgeInput,
  thresholds: ExperienceLoopThresholds = defaultExperienceLoopThresholds
): readonly MemoryNudge[] {
  const workItemId = normalizeRequiredText(input.workItemId, 'workItemId');
  const scope = input.scope ?? 'repo';
  const generatedAt = input.now ?? new Date().toISOString();
  const patternCounts = countPatternTags(input.evidence);
  const evidenceRefs = collectEvidenceRefs(input.evidence);

  return Array.from(patternCounts.entries())
    .filter(([, count]) => count >= thresholds.memoryNudgePatternCount)
    .sort(([leftTag], [rightTag]) => leftTag.localeCompare(rightTag))
    .map(([patternTag, count]) => ({
      schemaVersion: 'atm.memoryNudge.v0.1' as const,
      id: createStableId('memory-nudge', { workItemId, scope, patternTag, count }),
      workItemId,
      scope,
      suggestedKey: `${patternTag}.md`,
      suggestedContent: `Remember the recurring ATM experience pattern: ${patternTag}.`,
      rationale: `Pattern ${patternTag} appeared in ${count} evidence records.`,
      evidenceRefs,
      generatedAt
    }));
}

export const experienceExtractSkillBehavior: AtomBehavior = {
  behaviorId: 'experience-extract-skill-behavior',
  actionCategories: ['experience.extract-skill'],
  execute(_context, input) {
    if (input.action !== 'experience.extract-skill') {
      return createExperienceBehaviorFailure('experience-extract-action-mismatch', { action: input.action });
    }
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const extractionInput = normalizeExtractionPayload(payload);
    const report = extractSkillCandidate(extractionInput);
    const proposalSnapshot = createExperienceHumanReviewProposalSnapshot({
      kind: 'skill-candidate',
      atomId: input.atomId ?? 'ATM-EXP-0001',
      candidate: report.candidate,
      automatedGatePassed: report.ok,
      blockedGateNames: report.ok ? [] : ['extract-skill-confidence-threshold']
    });

    return {
      ok: report.ok,
      registryTransition: {
        fromStatus: 'active',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Experience extraction emits a reviewable skill candidate and does not mutate the registry.'
      },
      rollbackPlan: {
        steps: [
          'discard the generated skill candidate artifact',
          'leave the source task evidence unchanged',
          'require human review before promotion'
        ]
      },
      issues: report.ok ? [] : ['extract-skill-confidence-threshold-not-met'],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Experience extract-skill behavior generated a reviewable candidate.',
          artifactPaths: [],
          patternTags: report.candidate.patternTags,
          recurringSignal: report.candidate.patternTags.includes('recurring-error'),
          details: {
            action: input.action,
            skillCandidate: report.candidate,
            proposalSnapshot,
            threshold: report.threshold,
            crossedThreshold: report.ok,
            reviewRequired: true,
            mutation: 'none'
          }
        }
      ]
    };
  }
};

export const experienceSkillAmendBehavior: AtomBehavior = {
  behaviorId: 'experience-skill-amend-behavior',
  actionCategories: ['experience.amend-skill'],
  execute(_context, input) {
    if (input.action !== 'experience.amend-skill') {
      return createExperienceBehaviorFailure('experience-amend-action-mismatch', { action: input.action });
    }
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const proposal = createSkillAmendmentProposal({
      targetSkillId: String(payload.targetSkillId ?? input.atomId ?? '').trim(),
      triggeringEvidence: Array.isArray(payload.triggeringEvidence) ? payload.triggeringEvidence as EvidenceRecord[] : [],
      usageHistory: Array.isArray(payload.usageHistory) ? payload.usageHistory as SkillUsageRecord[] : [],
      rationale: typeof payload.rationale === 'string' ? payload.rationale : undefined
    });
    const proposalSnapshot = createExperienceHumanReviewProposalSnapshot({
      kind: 'skill-amendment',
      atomId: input.atomId ?? proposal.targetSkillId,
      candidate: proposal,
      automatedGatePassed: proposal.status === 'candidate',
      blockedGateNames: proposal.status === 'candidate' ? [] : ['skill-amendment-threshold']
    });

    return {
      ok: proposal.status === 'candidate',
      registryTransition: {
        fromStatus: 'active',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Skill amendment behavior emits a proposal and requires review before promotion.'
      },
      rollbackPlan: {
        steps: ['discard the generated amendment proposal', 'keep the existing skill unchanged']
      },
      issues: proposal.status === 'candidate' ? [] : ['skill-amendment-threshold-not-met'],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Experience amend-skill behavior generated a reviewable amendment proposal.',
          artifactPaths: [],
          details: {
            action: input.action,
            skillAmendmentProposal: proposal,
            proposalSnapshot,
            reviewRequired: true,
            mutation: 'none'
          }
        }
      ]
    };
  }
};

export const experienceMemoryNudgeBehavior: AtomBehavior = {
  behaviorId: 'experience-memory-nudge-behavior',
  actionCategories: ['experience.memory-nudge'],
  execute(_context, input) {
    if (input.action !== 'experience.memory-nudge') {
      return createExperienceBehaviorFailure('experience-memory-nudge-action-mismatch', { action: input.action });
    }
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const nudges = createMemoryNudges({
      workItemId: String(payload.workItemId ?? input.atomId ?? input.mapId ?? '').trim(),
      evidence: Array.isArray(payload.evidence) ? payload.evidence as EvidenceRecord[] : [],
      scope: payload.scope === 'user' || payload.scope === 'session' || payload.scope === 'repo' ? payload.scope : undefined
    });
    return {
      ok: nudges.length > 0,
      registryTransition: {
        fromStatus: 'active',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Memory nudge behavior emits host-routed suggestions and does not persist memory directly.'
      },
      rollbackPlan: {
        steps: ['discard unaccepted memory nudges', 'do not mutate host memory without adapter approval']
      },
      issues: nudges.length > 0 ? [] : ['memory-nudge-threshold-not-met'],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Experience memory-nudge behavior generated host-routed memory suggestions.',
          artifactPaths: [],
          details: {
            action: input.action,
            memoryNudges: nudges,
            reviewRequired: true,
            mutation: 'none'
          }
        }
      ]
    };
  }
};

export const experienceLoopBehaviors: readonly AtomBehavior[] = Object.freeze([
  experienceExtractSkillBehavior,
  experienceSkillAmendBehavior,
  experienceMemoryNudgeBehavior
]);

export function registerExperienceLoopBehaviors(registry: Pick<BehaviorRegistry, 'register'>): void {
  for (const behavior of experienceLoopBehaviors) registry.register(behavior);
}

function collectPatternTags(evidence: readonly EvidenceRecord[]): readonly string[] {
  const tags = new Set<string>();
  for (const evidenceRecord of evidence) {
    for (const tag of readPatternTags(evidenceRecord)) tags.add(tag);
    const summary = evidenceRecord.summary.toLowerCase();
    for (const detectorPattern of detectorPatterns) {
      if (detectorPattern.terms.some((term) => summary.includes(term))) {
        tags.add(detectorPattern.tag);
      }
    }
    if (evidenceRecord.recurringSignal === true) tags.add('recurring-error');
  }
  return Array.from(tags).sort((leftTag, rightTag) => leftTag.localeCompare(rightTag));
}

function normalizeExtractionPayload(payload: Record<string, unknown>): ExperienceExtractionInput {
  const extractionInput = payload.extractionInput && typeof payload.extractionInput === 'object'
    ? payload.extractionInput as Record<string, unknown>
    : payload;
  return {
    sourceTaskId: String(extractionInput.sourceTaskId ?? extractionInput.taskId ?? '').trim(),
    evidence: Array.isArray(extractionInput.evidence) ? extractionInput.evidence as EvidenceRecord[] : [],
    contextSummary: typeof extractionInput.contextSummary === 'string' || typeof extractionInput.contextSummary === 'object'
      ? extractionInput.contextSummary as ExperienceExtractionInput['contextSummary']
      : undefined,
    diffSummary: typeof extractionInput.diffSummary === 'string' ? extractionInput.diffSummary : undefined,
    proposedName: typeof extractionInput.proposedName === 'string' ? extractionInput.proposedName : undefined,
    proposedApplyTo: Array.isArray(extractionInput.proposedApplyTo) ? extractionInput.proposedApplyTo.map((entry) => String(entry)) : undefined,
    now: typeof extractionInput.now === 'string' ? extractionInput.now : undefined
  };
}

function createExperienceBehaviorFailure(issue: string, details: Readonly<Record<string, unknown>>): AtomBehaviorOutput {
  return {
    ok: false,
    issues: [issue],
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'Experience-loop behavior rejected input.',
        artifactPaths: [],
        details
      }
    ]
  };
}

function readPatternTags(evidenceRecord: EvidenceRecord): readonly string[] {
  const directTags = Array.isArray(evidenceRecord.patternTags) ? evidenceRecord.patternTags : [];
  const detailsTags = Array.isArray(evidenceRecord.details?.patternTags) ? evidenceRecord.details.patternTags : [];
  return [...directTags, ...detailsTags]
    .map((tag) => String(tag).trim().toLowerCase())
    .filter(Boolean);
}

function collectEvidenceRefs(evidence: readonly EvidenceRecord[]): readonly string[] {
  const refs = new Set<string>();
  for (const evidenceRecord of evidence) {
    if (evidenceRecord.evidenceId) refs.add(evidenceRecord.evidenceId);
    for (const artifactPath of evidenceRecord.artifactPaths ?? []) refs.add(artifactPath);
  }
  return Array.from(refs).sort((leftRef, rightRef) => leftRef.localeCompare(rightRef));
}

function countPatternTags(evidence: readonly EvidenceRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const evidenceRecord of evidence) {
    for (const patternTag of collectPatternTags([evidenceRecord])) {
      counts.set(patternTag, (counts.get(patternTag) ?? 0) + 1);
    }
  }
  return counts;
}

function calculateExtractionConfidence(
  evidence: readonly EvidenceRecord[],
  patternTags: readonly string[],
  contextSummary: ExperienceExtractionInput['contextSummary'],
  diffSummary: string | undefined
): number {
  const evidenceScore = Math.min(evidence.length * 0.08, 0.28);
  const patternScore = Math.min(patternTags.length * 0.07, 0.28);
  const contextScore = summarizeContext(contextSummary).length > 0 ? 0.12 : 0;
  const diffScore = typeof diffSummary === 'string' && diffSummary.trim().length > 0 ? 0.1 : 0;
  return clampConfidence(0.28 + evidenceScore + patternScore + contextScore + diffScore);
}

function createSkillDescription(sourceTaskId: string, patternTags: readonly string[]): string {
  const patternText = patternTags.length > 0 ? patternTags.join(', ') : 'repeated task evidence';
  return `USE FOR: recurring ATM task patterns involving ${patternText} after task ${sourceTaskId}. DO NOT USE FOR: one-off preferences or proposals without supporting evidence.`;
}

function createProposedSteps(evidence: readonly EvidenceRecord[], contextSummary: ExperienceExtractionInput['contextSummary']): readonly string[] {
  const steps = [
    'Read the task evidence and identify recurring pattern tags.',
    'Check the affected adapter, plugin, or contract boundary before editing.',
    'Run the smallest deterministic validator that covers the changed surface.'
  ];
  if (summarizeContext(contextSummary).length > 0) {
    steps.push('Carry forward the compact context summary instead of replaying full task history.');
  }
  if (evidence.some((evidenceRecord) => evidenceRecord.evidenceKind === 'review')) {
    steps.push('Attach review findings before promoting the candidate.');
  }
  return steps;
}

function createAmendmentSummary(targetSkillId: string, patternTags: readonly string[]): string {
  const patternText = patternTags.length > 0 ? patternTags.join(', ') : 'corrective evidence';
  return `Update ${targetSkillId} to address recurring ${patternText} before the next use.`;
}

function inferSkillName(sourceTaskId: string, patternTags: readonly string[]): string {
  if (patternTags.length > 0) return `experience-${patternTags[0]}`;
  return `experience-${sourceTaskId}`;
}

function normalizeSkillName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'experience-candidate';
}

function normalizeApplyTo(value: readonly string[] | undefined): readonly string[] {
  const normalized = Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  return normalized.length > 0 ? Array.from(new Set(normalized)).sort() : ['**/*'];
}

function summarizeContext(contextSummary: ExperienceExtractionInput['contextSummary']): string {
  if (typeof contextSummary === 'string') return contextSummary.trim();
  if (contextSummary && typeof contextSummary.summary === 'string') return contextSummary.summary.trim();
  return '';
}

function clampConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(0.95, value)) * 100) / 100;
}

function createStableId(prefix: string, payload: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
  return `${prefix}-${digest}`;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`Experience loop input missing ${fieldName}.`);
  return normalized;
}
