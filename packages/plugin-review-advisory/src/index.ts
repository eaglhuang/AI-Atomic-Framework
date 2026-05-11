export const pluginReviewAdvisoryPackage = {
  packageName: '@ai-atomic-framework/plugin-review-advisory',
  packageRole: 'semantic-review-advisory-provider',
  packageVersion: '0.0.0'
} as const;

export type AdvisoryProviderMode = 'stub' | 'agent-bridge' | 'external-cli';
export type AdvisorySeverity = 'high' | 'medium' | 'low' | 'info';
export type AdvisoryStatus = 'ok' | 'warn' | 'advisory-unavailable';

export interface AdvisoryProviderInfo {
  mode: AdvisoryProviderMode;
  providerId: string;
  providerVersion?: string;
  transport?: string;
}

export interface ReviewAdvisoryFinding {
  id: string;
  severity: AdvisorySeverity;
  trigger: 'semantic-anomaly' | 'behavior-route-risk' | 'policy-coverage-gap' | 'provider-health' | 'machine-finding';
  scope?: 'atom' | 'map' | 'proposal' | 'diff' | 'registry' | 'queue' | 'runtime';
  action: 'none' | 'monitor' | 'needs-review' | 'request-human-review' | 'provider-retry';
  routeHint?: string;
  message: string;
  evidenceRefs?: string[];
  metadata?: Record<string, unknown>;
}

export interface ReviewAdvisoryTarget {
  kind: 'atom' | 'map' | 'proposal' | 'diff' | 'scope';
  id?: string;
  sourcePaths?: string[];
}

export interface ReviewAdvisoryReport {
  schemaVersion: '1.0.0';
  reportId: string;
  status: AdvisoryStatus;
  provider: AdvisoryProviderInfo;
  generatedAt: string;
  target: ReviewAdvisoryTarget;
  summary: Record<AdvisorySeverity, number>;
  findings: ReviewAdvisoryFinding[];
  supplementalContext?: {
    humanReviewQueue?: {
      attachable: boolean;
      queuePath?: string;
      proposalId?: string;
      queueRecordStatus?: string;
    };
  };
  advisoryUnavailable: boolean;
  needsReview: boolean;
  unavailableReasons?: string[];
}

export interface ReviewAdvisoryReportInit {
  reportId: string;
  status?: AdvisoryStatus;
  provider: AdvisoryProviderInfo;
  generatedAt?: string;
  target: ReviewAdvisoryTarget;
  findings?: ReviewAdvisoryFinding[];
  unavailableReasons?: string[];
}

export function createReviewAdvisoryReport(init: ReviewAdvisoryReportInit): ReviewAdvisoryReport {
  const findings = Array.isArray(init.findings) ? [...init.findings] : [];
  const status = init.status ?? inferStatus(findings, init.unavailableReasons ?? []);
  const unavailableReasons = dedupeStrings(init.unavailableReasons ?? []);
  const advisoryUnavailable = status === 'advisory-unavailable' || unavailableReasons.length > 0;
  const needsReview = advisoryUnavailable || findings.some((finding) => finding.action === 'needs-review' || finding.action === 'request-human-review');

  return {
    schemaVersion: '1.0.0',
    reportId: init.reportId,
    status,
    provider: {
      mode: init.provider.mode,
      providerId: init.provider.providerId,
      providerVersion: init.provider.providerVersion,
      transport: init.provider.transport
    },
    generatedAt: init.generatedAt ?? new Date().toISOString(),
    target: {
      kind: init.target.kind,
      id: init.target.id,
      sourcePaths: init.target.sourcePaths ? dedupeStrings(init.target.sourcePaths) : undefined
    },
    summary: summarizeFindings(findings),
    findings,
    supplementalContext: {
      humanReviewQueue: {
        attachable: false
      }
    },
    advisoryUnavailable,
    needsReview,
    unavailableReasons
  };
}

export function createUnavailableAdvisoryReport(input: {
  reportId: string;
  provider: AdvisoryProviderInfo;
  target: ReviewAdvisoryTarget;
  reason: string;
}): ReviewAdvisoryReport {
  return createReviewAdvisoryReport({
    reportId: input.reportId,
    status: 'advisory-unavailable',
    provider: input.provider,
    target: input.target,
    unavailableReasons: [input.reason],
    findings: [
      {
        id: 'finding.provider.unavailable',
        severity: 'info',
        trigger: 'provider-health',
        scope: 'runtime',
        action: 'needs-review',
        routeHint: 'advisory-unavailable',
        message: 'Advisory provider unavailable; deterministic gates remain authoritative.',
        evidenceRefs: ['review-advisory.provider-unavailable']
      }
    ]
  });
}

export function createStubReviewAdvisoryReport(input: {
  profile: 'pass' | 'warn' | 'unavailable';
  reportId: string;
  target: ReviewAdvisoryTarget;
}): ReviewAdvisoryReport {
  if (input.profile === 'unavailable') {
    return createUnavailableAdvisoryReport({
      reportId: input.reportId,
      provider: {
        mode: 'stub',
        providerId: 'stub-provider',
        providerVersion: '1.0.0',
        transport: 'inproc'
      },
      target: input.target,
      reason: 'stub-unavailable-profile'
    });
  }

  if (input.profile === 'warn') {
    return createReviewAdvisoryReport({
      reportId: input.reportId,
      status: 'warn',
      provider: {
        mode: 'stub',
        providerId: 'stub-provider',
        providerVersion: '1.0.0',
        transport: 'inproc'
      },
      target: input.target,
      findings: [
        {
          id: 'finding.stub.warn.route-risk',
          severity: 'high',
          trigger: 'behavior-route-risk',
          scope: 'proposal',
          action: 'request-human-review',
          routeHint: 'human-review.required',
          message: 'Stub profile detected a potential behavior-route mismatch requiring human review.',
          evidenceRefs: ['review-advisory.stub.warn']
        }
      ]
    });
  }

  return createReviewAdvisoryReport({
    reportId: input.reportId,
    status: 'ok',
    provider: {
      mode: 'stub',
      providerId: 'stub-provider',
      providerVersion: '1.0.0',
      transport: 'inproc'
    },
    target: input.target,
    findings: [
      {
        id: 'finding.stub.pass',
        severity: 'info',
        trigger: 'semantic-anomaly',
        scope: 'proposal',
        action: 'monitor',
        routeHint: 'human-review.supplemental',
        message: 'Stub profile found no actionable semantic risk.',
        evidenceRefs: ['review-advisory.stub.pass']
      }
    ]
  });
}

export function appendMachineFindings(
  report: ReviewAdvisoryReport,
  machineFindings: Array<{ id: string; severity?: AdvisorySeverity; message: string; routeHint?: string; evidenceRef?: string }>
): ReviewAdvisoryReport {
  if (!Array.isArray(machineFindings) || machineFindings.length === 0) {
    return report;
  }

  const normalizedFindings: ReviewAdvisoryFinding[] = machineFindings.map((finding, index) => ({
    id: finding.id || `finding.machine.${index + 1}`,
    severity: finding.severity ?? 'low',
    trigger: 'machine-finding',
    scope: 'proposal',
    action: finding.severity === 'high' ? 'request-human-review' : 'needs-review',
    routeHint: finding.routeHint ?? 'human-review.supplemental',
    message: finding.message,
    evidenceRefs: finding.evidenceRef ? [finding.evidenceRef] : undefined,
    metadata: {
      source: 'machine-finding-ingest'
    }
  }));

  const mergedFindings = [...report.findings, ...normalizedFindings];
  return {
    ...report,
    status: inferStatus(mergedFindings, report.unavailableReasons ?? []),
    summary: summarizeFindings(mergedFindings),
    findings: mergedFindings,
    needsReview: report.advisoryUnavailable
      || mergedFindings.some((finding) => finding.action === 'needs-review' || finding.action === 'request-human-review')
  };
}

export function normalizeProviderPayload(
  payload: unknown,
  fallback: { reportId: string; provider: AdvisoryProviderInfo; target: ReviewAdvisoryTarget }
): { ok: true; report: ReviewAdvisoryReport } | { ok: false; issues: string[]; report: ReviewAdvisoryReport } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      issues: ['provider-payload-not-object'],
      report: createUnavailableAdvisoryReport({
        reportId: fallback.reportId,
        provider: fallback.provider,
        target: fallback.target,
        reason: 'provider-payload-not-object'
      })
    };
  }

  const candidate = payload as Partial<ReviewAdvisoryReport>;
  if (!Array.isArray(candidate.findings)) {
    return {
      ok: false,
      issues: ['provider-findings-not-array'],
      report: createUnavailableAdvisoryReport({
        reportId: fallback.reportId,
        provider: fallback.provider,
        target: fallback.target,
        reason: 'provider-findings-not-array'
      })
    };
  }

  const findings = candidate.findings.filter((finding): finding is ReviewAdvisoryFinding => {
    if (!finding || typeof finding !== 'object') {
      return false;
    }
    const typed = finding as ReviewAdvisoryFinding;
    return typeof typed.id === 'string' && typed.id.length > 0 && typeof typed.message === 'string' && typed.message.length > 0;
  });

  const report = createReviewAdvisoryReport({
    reportId: candidate.reportId && typeof candidate.reportId === 'string' ? candidate.reportId : fallback.reportId,
    status: candidate.status,
    provider: {
      ...fallback.provider,
      ...(candidate.provider ?? {})
    },
    generatedAt: candidate.generatedAt,
    target: candidate.target && typeof candidate.target === 'object'
      ? {
        ...fallback.target,
        ...(candidate.target as ReviewAdvisoryTarget)
      }
      : fallback.target,
    findings,
    unavailableReasons: candidate.unavailableReasons
  });

  const issues: string[] = [];
  if (findings.length !== candidate.findings.length) {
    issues.push('provider-findings-filtered');
  }

  if (issues.length > 0) {
    return { ok: false, issues, report };
  }

  return { ok: true, report };
}

function inferStatus(findings: ReviewAdvisoryFinding[], unavailableReasons: string[]): AdvisoryStatus {
  if (unavailableReasons.length > 0) {
    return 'advisory-unavailable';
  }
  const hasWarn = findings.some((finding) => finding.severity === 'high' || finding.severity === 'medium');
  return hasWarn ? 'warn' : 'ok';
}

function summarizeFindings(findings: ReviewAdvisoryFinding[]): Record<AdvisorySeverity, number> {
  return {
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length,
    info: findings.filter((finding) => finding.severity === 'info').length
  };
}

function dedupeStrings(input: string[]): string[] {
  return Array.from(new Set(input.filter((item) => typeof item === 'string' && item.length > 0)));
}

export default {
  pluginReviewAdvisoryPackage,
  createReviewAdvisoryReport,
  createUnavailableAdvisoryReport,
  createStubReviewAdvisoryReport,
  appendMachineFindings,
  normalizeProviderPayload
};
