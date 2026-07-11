import { buildRollbackSuppressionKey } from '../suppression-keys.ts';
import type {
  RollbackPoliceInput,
  RollbackPoliceProposal,
  RollbackPoliceSignalKind,
  PoliceFamilyReport,
  PoliceFinding,
  PoliceFindingSeverity
} from '../types.ts';
import {
  makeEvidenceRef,
  makePoliceFinding,
  makePoliceFamilyReport,
  sanitizeId
} from '../shared.ts';

export function runRollbackPolice(input: RollbackPoliceInput = {}): PoliceFamilyReport {
  const suppressed = new Set(input.suppressedKeys ?? []);
  const findings: PoliceFinding[] = [];

  for (const proposal of input.proposals ?? []) {
    const issues = evaluateRollbackProposal(proposal);
    for (const issue of issues) {
      const key = buildRollbackSuppressionKey({
        proposalId: proposal.proposalId,
        signalKind: issue.trigger,
        baseVersion: proposal.baseVersion
      });
      if (suppressed.has(key)) continue;
      findings.push(makePoliceFinding({
        findingId: `police.rollback.${issue.trigger}.${sanitizeId(proposal.proposalId)}`,
        policeFamily: 'rollback',
        severity: issue.severity,
        trigger: issue.trigger,
        scope: proposal.proposalId,
        action: issue.severity === 'block' ? 'request-human-review' : 'needs-review',
        routeHint: 'review.rollback',
        readModel: 'RollbackProposal.reversibility',
        message: issue.message,
        evidenceRefs: [makeEvidenceRef('rollback-proof', 'police-artifact')],
        metadata: {
          proposalId: proposal.proposalId,
          riskClass: proposal.riskClass,
          baseVersion: proposal.baseVersion,
          rollbackScope: proposal.rollbackScope ? [...proposal.rollbackScope] : [],
          touchedSurfaces: proposal.touchedSurfaces ? [...proposal.touchedSurfaces] : [],
          suppressionKey: key,
          directApplyAllowed: false
        }
      }));
    }
  }

  const status = findings.some((finding) => finding.severity === 'block' || finding.severity === 'error') ? 'fail' : 'pass';
  return makePoliceFamilyReport({
    family: 'rollback',
    mode: 'advisory',
    status,
    findings,
    sourceValidator: 'runRollbackPolice'
  });
}

export function evaluateRollbackProposal(proposal: RollbackPoliceProposal): Array<{
  readonly trigger: RollbackPoliceSignalKind;
  readonly severity: PoliceFindingSeverity;
  readonly message: string;
}> {
  const issues: Array<{ trigger: RollbackPoliceSignalKind; severity: PoliceFindingSeverity; message: string }> = [];
  const hasAnyEvidence = Boolean(proposal.hasRollbackProof || proposal.hasEquivalenceProof || proposal.hasRetirementProof || proposal.hasReversiblePatchEnvelope);

  if (!hasAnyEvidence) {
    issues.push({
      trigger: 'irreversible-proposal',
      severity: 'block',
      message: `Proposal ${proposal.proposalId} (${proposal.riskClass}) has no rollback/equivalence/retirement/reversible-patch evidence.`
    });
  }

  if (proposal.riskClass === 'atom-evolve' && !proposal.hasRollbackProof && !proposal.hasReversiblePatchEnvelope) {
    issues.push({
      trigger: 'rollback-proof-missing',
      severity: 'block',
      message: `Atom evolve proposal ${proposal.proposalId} requires rollback proof or reversible patch envelope.`
    });
  }
  if (proposal.riskClass === 'map-replacement' && !proposal.hasEquivalenceProof) {
    issues.push({
      trigger: 'equivalence-proof-missing',
      severity: 'block',
      message: `Map replacement proposal ${proposal.proposalId} requires map equivalence proof.`
    });
  }
  if (proposal.riskClass === 'legacy-retired' && !proposal.hasRetirementProof && !proposal.hasRollbackProof) {
    issues.push({
      trigger: 'retirement-proof-missing',
      severity: 'block',
      message: `Legacy retired proposal ${proposal.proposalId} requires retirement proof or rollback proof.`
    });
  }
  if ((proposal.riskClass === 'atomize' || proposal.riskClass === 'infect') && !proposal.hasReversiblePatchEnvelope) {
    issues.push({
      trigger: 'rollback-proof-missing',
      severity: 'block',
      message: `${proposal.riskClass} proposal ${proposal.proposalId} requires dry-run reversible patch envelope.`
    });
  }
  if (proposal.touchedSurfaces && proposal.rollbackScope) {
    const scopeSet = new Set(proposal.rollbackScope);
    const drifted = proposal.touchedSurfaces.filter((surface) => !scopeSet.has(surface));
    if (drifted.length > 0) {
      issues.push({
        trigger: 'rollback-scope-drift',
        severity: 'warning',
        message: `Proposal ${proposal.proposalId} touches surfaces outside rollback scope: ${drifted.join(', ')}.`
      });
    }
  }
  return issues;
}
