import { computeDecisionSnapshotHash, validateHumanReviewQueueRecord } from './queue.js';
export const humanReviewDecisionPackage = {
    packageName: '@ai-atomic-framework/plugin-human-review',
    packageRole: 'human-review-decision-helpers',
    packageVersion: '0.0.0'
};
export function createHumanReviewDecisionLog(input) {
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
    const reviewedQueueRecord = {
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
    const evidence = {
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
            replayCommand: ['node', 'scripts/validate-human-review.ts'],
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
export function validateHumanReviewDecisionLog(log) {
    const issues = [];
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
function buildDecisionId(proposalId, decision) {
    return `decision.${proposalId}.${decision}`;
}
function buildEvidenceId(proposalId, decision) {
    return `evidence.${proposalId}.${decision}`;
}
function cloneQueueRecord(record) {
    return JSON.parse(JSON.stringify(record));
}
