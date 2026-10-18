import { buildRollbackSuppressionKey } from '../suppression-keys.js';
import { evaluateRollbackProposal } from './rollback.js';
import { makeEvidenceRef, makePoliceFinding, sanitizeId } from '../shared.js';
export function runReversibilityGate(input = {}) {
    const suppressed = new Set(input.suppressedKeys ?? []);
    const findings = [];
    let blocked = 0;
    for (const proposal of input.proposals ?? []) {
        const issues = evaluateRollbackProposal(proposal);
        for (const issue of issues) {
            const key = buildRollbackSuppressionKey({
                proposalId: proposal.proposalId,
                signalKind: issue.trigger,
                baseVersion: proposal.baseVersion
            });
            if (suppressed.has(key))
                continue;
            if (issue.severity === 'block')
                blocked += 1;
            findings.push(makePoliceFinding({
                findingId: `gate.reversibility.${issue.trigger}.${sanitizeId(proposal.proposalId)}`,
                policeFamily: 'rollback',
                severity: issue.severity,
                trigger: issue.trigger,
                scope: proposal.proposalId,
                action: issue.severity === 'block' ? 'request-human-review' : 'needs-review',
                routeHint: 'gate.reversibility',
                readModel: 'ReversibilityGate',
                message: issue.message,
                evidenceRefs: [makeEvidenceRef('reversibility-gate', 'police-artifact')],
                metadata: {
                    proposalId: proposal.proposalId,
                    riskClass: proposal.riskClass,
                    suppressionKey: key,
                    gate: 'reversibility',
                    directApplyAllowed: false
                }
            }));
        }
    }
    return {
        gate: 'reversibility',
        status: blocked > 0 ? 'fail' : findings.length > 0 ? 'advisory' : 'pass',
        findings,
        summary: { total: findings.length, blocked },
        sourceValidator: 'runReversibilityGate'
    };
}
