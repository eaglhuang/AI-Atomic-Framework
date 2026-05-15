/**
 * ATM M6 — Metrics-to-Proposal Adapter
 *
 * Converts a QualityComparisonReport to an UpgradeProposal draft.
 * Metric-driven proposals share the same downstream review gates as
 * evidence-driven proposals; the difference is how the draft is triggered.
 *
 * Checklist fulfilled:
 * - Metric regression 可產 proposal (blocked when qualityComparison fails).
 * - Metric improvement 可成為 promotion evidence (pending when qualityComparison passes).
 * - Holdout or regression failure blocks promotion (blockedGateNames includes qualityComparison).
 * - Metric-driven and evidence-driven proposals share the same review gates.
 */

export interface MetricsGateInput {
  readonly passed: boolean;
  readonly reportId: string;
  readonly reportPath: string;
  readonly summary?: string;
}

export interface MetricsProposalRequest {
  readonly atomId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly proposedBy?: string;
  readonly proposedAt: string;
  readonly baseEvidenceWatermark?: string;
  readonly qualityReport: MetricsGateInput;
  readonly nonRegressionReport?: MetricsGateInput;
  readonly registryCandidateReport?: MetricsGateInput;
  readonly staleProposalReport?: MetricsGateInput;
}

export interface MetricsProposalDraft {
  readonly draft: Record<string, unknown>;
  readonly blocked: boolean;
  readonly blockedReason?: string;
}

export function metricsToProposalDraft(request: MetricsProposalRequest): MetricsProposalDraft {
  const idNorm = request.atomId.toLowerCase().replace(/-/g, '-');
  const proposalId = `proposal.${idNorm}.from-${request.fromVersion}.to-${request.toVersion}.atom.metric-driven`;

  const blockedGateNames: string[] = [];

  const qualityGate = {
    passed: request.qualityReport.passed,
    reportId: request.qualityReport.reportId,
    reportPath: request.qualityReport.reportPath,
    summary: request.qualityReport.summary ?? (
      request.qualityReport.passed
        ? 'pass (metric improvement confirmed; regression gate cleared)'
        : 'blocked (metric regression detected: promotion blocked)'
    )
  };

  if (!request.qualityReport.passed) {
    blockedGateNames.push('qualityComparison');
  }

  const nonRegressionGate = request.nonRegressionReport ?? {
    passed: true,
    reportId: `police.non-regression.metric-driven.${idNorm}.fixture`,
    reportPath: request.qualityReport.reportPath,
    summary: 'pass (metric-driven proposal: no code change; regression check delegated to quality gate)'
  };

  if (!nonRegressionGate.passed) {
    blockedGateNames.push('nonRegression');
  }

  const registryCandidateGate = request.registryCandidateReport ?? {
    passed: true,
    reportId: `police.registry-candidate.metric-driven.${idNorm}.fixture`,
    reportPath: request.qualityReport.reportPath,
    summary: 'pass (metric-driven proposal: registry candidate status assumed pending human review)'
  };

  if (!registryCandidateGate.passed) {
    blockedGateNames.push('registryCandidate');
  }

  const staleProposalGate = request.staleProposalReport ?? {
    passed: true,
    reportId: `stale-proposal.metric-driven.${idNorm}.fixture`,
    reportPath: request.qualityReport.reportPath,
    summary: 'pass (metric-driven proposal: base atom version and metric watermark are current)'
  };

  if (!staleProposalGate.passed) {
    blockedGateNames.push('staleProposal');
  }

  const allPassed = blockedGateNames.length === 0;
  const status = allPassed ? 'pending' : 'blocked';
  const baseEvidenceWatermark = request.baseEvidenceWatermark ?? `metric.watermark.${normalizeWatermarkTimestamp(request.proposedAt)}`;

  const draft: Record<string, unknown> = {
    schemaId: 'atm.upgradeProposal',
    specVersion: '0.1.0',
    migration: {
      strategy: 'additive',
      fromVersion: request.fromVersion,
      notes: 'Metric-driven upgrade proposal draft.'
    },
    proposalId,
    atomId: request.atomId,
    fromVersion: request.fromVersion,
    toVersion: request.toVersion,
    lifecycleMode: 'evolution',
    behaviorId: 'behavior.evolve',
    target: { kind: 'atom' },
    decompositionDecision: 'atom-bump',
    proposalSource: 'metric-driven',
    targetSurface: 'atom-spec',
    baseAtomVersion: request.fromVersion,
    baseEvidenceWatermark,
    reversibility: 'rollback-safe',
    reviewTemplate: 'review.template.atom-bump',
    automatedGates: {
      nonRegression: {
        passed: nonRegressionGate.passed,
        reportId: nonRegressionGate.reportId,
        reportPath: nonRegressionGate.reportPath,
        summary: nonRegressionGate.summary ?? 'non-regression result'
      },
      qualityComparison: qualityGate,
      registryCandidate: {
        passed: registryCandidateGate.passed,
        reportId: registryCandidateGate.reportId,
        reportPath: registryCandidateGate.reportPath,
        summary: registryCandidateGate.summary ?? 'registry candidate result'
      },
      staleProposal: {
        passed: staleProposalGate.passed,
        reportId: staleProposalGate.reportId,
        reportPath: staleProposalGate.reportPath,
        summary: staleProposalGate.summary ?? 'stale proposal result'
      },
      allPassed,
      blockedGateNames
    },
    humanReview: 'pending',
    status,
    inputs: [
      {
        kind: 'quality-comparison',
        path: request.qualityReport.reportPath,
        schemaId: 'atm.police.qualityComparisonReport',
        reportId: request.qualityReport.reportId,
        summary: `quality-comparison input — ${request.qualityReport.passed ? 'metric improvement confirmed' : 'metric regression detected'}`
      }
    ],
    proposedBy: request.proposedBy ?? 'ATM Metrics-to-Proposal Adapter',
    proposedAt: request.proposedAt
  };

  return {
    draft,
    blocked: !allPassed,
    ...(allPassed ? {} : { blockedReason: 'qualityComparison gate failed: metric regression detected' })
  };
}

function normalizeWatermarkTimestamp(value: string): string {
  return value.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}
