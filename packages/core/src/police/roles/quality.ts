import {
  compareQualityMetrics,
  renderQualityReportMarkdown,
  type QualityComparisonReport
} from '../regression-compare.ts';
import type {
  QualityPoliceInput,
  PoliceFamilyReport,
  PoliceFinding
} from '../types.ts';
import {
  makeEvidenceRef,
  makePoliceFinding,
  makePoliceFamilyReport,
  sanitizeId
} from '../shared.ts';

export function runQualityPolice(input: QualityPoliceInput = {}): PoliceFamilyReport {
  const report = (input.qualityComparisonReport ?? (
    input.qualityComparisonInput ? compareQualityMetrics(input.qualityComparisonInput) : null
  )) as QualityComparisonReport | null;
  const findings: PoliceFinding[] = [];

  if (!report) {
    return makePoliceFamilyReport({
      family: 'quality',
      mode: 'blocker',
      status: 'skipped',
      findings,
      sourceValidator: 'runQualityPolice'
    });
  }

  for (const metric of report.regressedMetrics ?? []) {
    findings.push(makePoliceFinding({
      findingId: `police.quality.regression.${sanitizeId(report.atomId)}.${sanitizeId(metric)}`,
      policeFamily: 'quality',
      severity: 'block',
      trigger: 'quality-regression',
      scope: `${report.atomId}@${report.fromVersion}->${report.toVersion}`,
      action: 'request-human-review',
      routeHint: 'behavior.evolve',
      readModel: 'compareQualityMetrics.regressedMetrics',
      message: `Quality regression detected for ${report.atomId}: ${metric}.`,
      evidenceRefs: [makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison')],
      metadata: {
        metric,
        reportId: report.reportId
      }
    }));
  }

  for (const status of report.mapImpactScope?.propagationStatus ?? []) {
    if (status.integrationTestPassed !== false) {
      continue;
    }
    findings.push(makePoliceFinding({
      findingId: `police.quality.map-propagation-failure.${sanitizeId(status.mapId)}`,
      policeFamily: 'quality',
      severity: 'block',
      trigger: 'map-propagation-failure',
      scope: status.mapId,
      action: 'request-human-review',
      routeHint: 'behavior.compose',
      readModel: 'compareQualityMetrics.mapImpactScope',
      message: `Map propagation failed for ${status.mapId}${status.message ? `: ${status.message}` : '.'}`,
      evidenceRefs: [
        makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison'),
        makeEvidenceRef('map-propagation-log', 'police-artifact')
      ],
      metadata: {
        propagationStatus: status,
        reportId: report.reportId
      }
    }));
  }

  for (const candidate of report.dedupCandidates ?? []) {
    findings.push(makePoliceFinding({
      findingId: `police.quality.dedup-hint.${sanitizeId(candidate.atomId)}`,
      policeFamily: 'quality',
      severity: 'advisory',
      trigger: 'quality-dedup-candidate',
      scope: candidate.atomId,
      action: 'needs-review',
      routeHint: 'behavior.dedup-merge',
      readModel: 'compareQualityMetrics.dedupCandidates',
      message: `Quality comparison surfaced dedup candidate ${candidate.atomId}.`,
      evidenceRefs: [makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison')],
      metadata: {
        candidate
      }
    }));
  }

  return makePoliceFamilyReport({
    family: 'quality',
    mode: 'blocker',
    status: findings.some((finding) => finding.severity === 'block' || finding.severity === 'error') ? 'fail' : 'pass',
    findings,
    sourceValidator: 'runQualityPolice'
  });
}

export function renderQualityPoliceMarkdown(input: QualityPoliceInput): string {
  const report = (input.qualityComparisonReport ?? (
    input.qualityComparisonInput ? compareQualityMetrics(input.qualityComparisonInput) : null
  )) as QualityComparisonReport | null;
  return report ? renderQualityReportMarkdown(report) : '# Quality Comparison Report\n\nNo quality comparison report was provided.\n';
}
