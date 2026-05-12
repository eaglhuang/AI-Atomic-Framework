import type { EvidenceRecord } from '@ai-atomic-framework/core';
import {
  computeDecisionSnapshotHash,
  type HumanReviewDecision,
  type HumanReviewQueueRecord,
  validateHumanReviewQueueRecord
} from './queue.ts';

export interface HumanReviewDecisionLogInput {
  readonly queueRecord: HumanReviewQueueRecord;
  readonly decision: HumanReviewDecision;
  readonly reason: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly queuePath: string;
  readonly projectionPath: string;
  readonly evidenceId?: string;
}

export interface HumanReviewDecisionEvidence extends EvidenceRecord {
  readonly schemaId: 'atm.evidence.humanReviewDecision';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
}

export interface HumanReviewDecisionLog {
  readonly schemaId: 'atm.humanReviewDecision';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly decisionId: string;
  readonly proposalId: string;
  readonly atomId: string;
  readonly decision: HumanReviewDecision;
  readonly reason: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly decisionSnapshotHash: string;
  readonly queuePath: string;
  readonly projectionPath: string;
  readonly queueRecord: HumanReviewQueueRecord;
  readonly evidence: HumanReviewDecisionEvidence;
}

export interface HumanReviewDecisionValidationResult {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export const humanReviewDecisionPackage = {
  packageName: '@ai-atomic-framework/plugin-human-review',
  packageRole: 'human-review-decision-helpers',
  packageVersion: '0.0.0'
} as const;

export function createHumanReviewDecisionLog(input: HumanReviewDecisionLogInput): HumanReviewDecisionLog {
  const queueRecord = cloneQueueRecord(input.queueRecord);
  const validation = validateHumanReviewQueueRecord(queueRecord);
  if (!validation.ok) {
    throw new Error(`Human review queue record is invalid: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
  }

  const decisionSnapshotHash = computeDecisionSnapshotHash(queueRecord.proposal);
  if (queueRecord.proposalSnapshotHash !== decisionSnapshotHash) {
    throw new Error(`Decision snapshot hash mismatch for ${queueRecord.proposalId}: expected ${queueRecord.proposalSnapshotHash}, got ${decisionSnapshotHash}`);
  }

  const reviewStatus = input.decision === 'approve' ? 'approved' : 'rejected';
  const evidenceId = input.evidenceId ?? buildEvidenceId(queueRecord.proposalId, input.decision);
  const reviewedQueueRecord: HumanReviewQueueRecord = {
    ...queueRecord,
    status: reviewStatus,
    review: {
      decision: input.decision,
      reason: input.reason,
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      decisionSnapshotHash,
      evidenceId
    }
  };

  const evidence: HumanReviewDecisionEvidence = {
    schemaId: 'atm.evidence.humanReviewDecision',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Human review decision evidence contract.'
    },
    evidenceId,
    workItemId: queueRecord.atomId,
    evidenceKind: 'review',
    evidenceType: 'human-review-decision',
    summary: `Human review ${input.decision} for ${queueRecord.proposalId}.`,
    artifactPaths: [input.queuePath, input.projectionPath],
    createdAt: input.decidedAt,
    producedBy: input.decidedBy,
    reproducibility: {
      replayable: true,
      replayCommand: ['node', 'scripts/validate-human-review.mjs'],
      inputs: [input.queuePath],
      expectedArtifacts: [input.queuePath, input.projectionPath],
      notes: 'Replay the human review decision against the queue snapshot and decision hash.'
    },
    details: {
      proposalId: queueRecord.proposalId,
      atomId: queueRecord.atomId,
      decision: input.decision,
      reason: input.reason,
      queuePath: input.queuePath,
      projectionPath: input.projectionPath,
      decisionSnapshotHash,
      queueStatus: reviewedQueueRecord.status
    }
  };

  return {
    schemaId: 'atm.humanReviewDecision',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial human review decision contract.'
    },
    decisionId: buildDecisionId(queueRecord.proposalId, input.decision),
    proposalId: queueRecord.proposalId,
    atomId: queueRecord.atomId,
    decision: input.decision,
    reason: input.reason,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
    decisionSnapshotHash,
    queuePath: input.queuePath,
    projectionPath: input.projectionPath,
    queueRecord: reviewedQueueRecord,
    evidence
  };
}

export function validateHumanReviewDecisionLog(log: HumanReviewDecisionLog): HumanReviewDecisionValidationResult {
  const issues: string[] = [];
  if (!log || typeof log !== 'object') {
    return {
      ok: false,
      issues: ['decision log must be an object.']
    };
  }

  const queueValidation = validateHumanReviewQueueRecord(log.queueRecord);
  for (const issue of queueValidation.issues) {
    issues.push(`${issue.path} ${issue.message}`);
  }

  if (log.queueRecord.review?.decisionSnapshotHash !== log.decisionSnapshotHash) {
    issues.push('queue record review hash must match decisionSnapshotHash.');
  }
  if (log.evidence.evidenceKind !== 'review') {
    issues.push('evidenceKind must be review.');
  }
  if (log.evidence.evidenceType !== 'human-review-decision') {
    issues.push('evidenceType must be human-review-decision.');
  }
  if (log.evidence.workItemId !== log.atomId) {
    issues.push('evidence workItemId must match atomId.');
  }
  if (log.evidence.details?.decisionSnapshotHash !== log.decisionSnapshotHash) {
    issues.push('evidence details must carry the same decisionSnapshotHash.');
  }
  if (!Array.isArray(log.evidence.artifactPaths) || !log.evidence.artifactPaths.includes(log.queuePath) || !log.evidence.artifactPaths.includes(log.projectionPath)) {
    issues.push('evidence artifactPaths must include the queue and projection paths.');
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function buildDecisionId(proposalId: string, decision: HumanReviewDecision) {
  return `decision.${proposalId}.${decision}`;
}

function buildEvidenceId(proposalId: string, decision: HumanReviewDecision) {
  return `evidence.${proposalId}.${decision}`;
}

function cloneQueueRecord(record: HumanReviewQueueRecord): HumanReviewQueueRecord {
  return JSON.parse(JSON.stringify(record));
}
