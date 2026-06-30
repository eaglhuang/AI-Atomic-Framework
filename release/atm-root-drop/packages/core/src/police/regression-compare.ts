/**
 * ATM-2-0017: Regression Matrix Compare Gate
 *
 * Compare two revisions of atom quality metrics and produce
 * a quality-comparison report with optional map impact scope
 * and advisory dedup sections.
 */

const DEFAULT_METRIC_CONFIG: Record<string, MetricConfigRecord> = {
  errorRate: { direction: 'lower-is-better', tolerance: 0 },
  coverage: { direction: 'higher-is-better', tolerance: 0 },
  latency: { direction: 'lower-is-better', tolerance: 50 },
  edgeCaseCount: { direction: 'higher-is-better', tolerance: 0 }
};

type MetricDirection = 'lower-is-better' | 'higher-is-better' | 'informational';

interface MetricConfigRecord {
  readonly direction?: MetricDirection;
  readonly tolerance?: number;
}

interface PropagationStatusRecord {
  readonly mapId?: string;
  readonly integrationTestPassed?: boolean;
  readonly message?: string | null;
}

interface MapImpactScopeRecord {
  readonly affectedMapIds: string[];
  readonly propagationStatus: PropagationStatusRecord[];
}

interface DedupCandidateRecord {
  readonly atomId?: string;
  readonly similarity?: number;
  readonly semanticFingerprint?: string | null;
  readonly polymorphGroupId?: string;
  readonly reason?: string;
  readonly [key: string]: unknown;
}

interface PolymorphContextRecord {
  readonly groupId?: string;
  readonly instanceAtomIds?: unknown[];
}

interface QualityMetricDeltaRecord {
  readonly name: string;
  readonly baseline: number;
  readonly current: number;
  readonly delta: number;
  readonly direction: MetricDirection;
  readonly tolerance: number;
  readonly passed: boolean;
}

interface QualityCompareOptions {
  readonly atomId?: string;
  readonly fromVersion?: string;
  readonly toVersion?: string;
  readonly baselineMetrics?: Record<string, number>;
  readonly currentMetrics?: Record<string, number>;
  readonly metricConfig?: Record<string, MetricConfigRecord>;
  readonly mapImpactScope?: MapImpactScopeRecord | null;
  readonly dedupCandidates?: DedupCandidateRecord[] | null;
  readonly polymorphContext?: PolymorphContextRecord | null;
}

export interface QualityComparisonReport {
  atomId: string;
  fromVersion: string;
  toVersion: string;
  generatedAt: string;
  passed: boolean;
  regressed: boolean;
  regressedMetrics: string[];
  metrics: QualityMetricDeltaRecord[];
  reportId?: string;
  mapImpactScope?: MapImpactScopeRecord;
  dedupCandidates?: DedupCandidateRecord[];
  dedupIgnoredAsPolymorph?: DedupCandidateRecord[];
}

function asRecord<T extends object>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as T
    : null;
}

export function compareQualityMetrics(options: QualityCompareOptions | Record<string, unknown>) {
  const normalizedOptions = options as QualityCompareOptions;
  const {
    atomId,
    fromVersion,
    toVersion,
    baselineMetrics,
    currentMetrics,
    metricConfig = {},
    mapImpactScope = null,
    dedupCandidates = null,
    polymorphContext = null
  } = normalizedOptions;
  const normalizedBaselineMetrics = baselineMetrics ?? {};
  const normalizedCurrentMetrics = currentMetrics ?? {};

  const mergedConfig = { ...DEFAULT_METRIC_CONFIG, ...metricConfig };
  const allMetricNames = new Set([
    ...Object.keys(normalizedBaselineMetrics),
    ...Object.keys(normalizedCurrentMetrics)
  ]);

  const metricDeltas: QualityMetricDeltaRecord[] = [];
  const regressedMetrics: string[] = [];

  for (const name of allMetricNames) {
    const baseline = normalizedBaselineMetrics[name] ?? 0;
    const current = normalizedCurrentMetrics[name] ?? 0;
    const delta = current - baseline;
    const config: MetricConfigRecord = mergedConfig[name] ?? { direction: 'informational', tolerance: 0 };

    let passed = true;
    if (config.direction === 'lower-is-better') {
      passed = current <= baseline + (config.tolerance ?? 0);
    } else if (config.direction === 'higher-is-better') {
      passed = current >= baseline - (config.tolerance ?? 0);
    }

    if (!passed) {
      regressedMetrics.push(name);
    }

    metricDeltas.push({
      name,
      baseline,
      current,
      delta,
      direction: config.direction ?? 'informational',
      tolerance: config.tolerance ?? 0,
      passed
    });
  }

  const mapFailed = mapImpactScope?.propagationStatus?.some(
    (status) => status.integrationTestPassed === false
  ) ?? false;

  const regressed = regressedMetrics.length > 0;
  const passed = !regressed && !mapFailed;

  const report: QualityComparisonReport & Record<string, unknown> = {
    schemaId: 'atm.police.qualityComparisonReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Quality comparison for evolution gate.'
    },
    reportId: `police.quality-compare.${String(atomId).toLowerCase()}.${fromVersion}-to-${toVersion}`,
    generatedAt: new Date().toISOString(),
    lifecycleMode: 'evolution',
    atomId: atomId ?? '',
    fromVersion: fromVersion ?? '',
    toVersion: toVersion ?? '',
    metrics: metricDeltas,
    regressed,
    passed,
    regressedMetrics
  };

  if (mapImpactScope) {
    report.mapImpactScope = mapImpactScope;
  }

  if (dedupCandidates && dedupCandidates.length > 0) {
    const { kept, ignored } = filterPolymorphDedupCandidates(dedupCandidates, polymorphContext);
    if (kept.length > 0) {
      report.dedupCandidates = kept;
    }
    if (ignored.length > 0) {
      report.dedupIgnoredAsPolymorph = ignored;
    }
  }

  return report;
}

export function renderQualityReportMarkdown(report: QualityComparisonReport | Record<string, unknown>) {
  const qualityReport = report as QualityComparisonReport;
  const lines: string[] = [];

  lines.push('# Quality Comparison Report');
  lines.push('');
  lines.push(`- **Atom**: ${qualityReport.atomId}`);
  lines.push(`- **From**: ${qualityReport.fromVersion} -> **To**: ${qualityReport.toVersion}`);
  lines.push(`- **Generated**: ${qualityReport.generatedAt}`);
  lines.push(`- **Result**: ${qualityReport.passed ? 'PASSED' : 'FAILED'}`);
  lines.push('');

  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Baseline | Current | Delta | Direction | Tolerance | Result |');
  lines.push('|--------|----------|---------|-------|-----------|-----------|--------|');
  for (const metric of qualityReport.metrics) {
    const result = metric.passed ? 'PASS' : 'FAIL';
    const deltaStr = metric.delta >= 0 ? `+${metric.delta}` : `${metric.delta}`;
    lines.push(`| ${metric.name} | ${metric.baseline} | ${metric.current} | ${deltaStr} | ${metric.direction} | ${metric.tolerance ?? 0} | ${result} |`);
  }
  lines.push('');

  if (qualityReport.mapImpactScope) {
    lines.push('## Map Impact Scope');
    lines.push('');
    if (qualityReport.mapImpactScope.affectedMapIds.length === 0) {
      lines.push('No maps affected.');
    } else {
      lines.push(`Affected maps: ${qualityReport.mapImpactScope.affectedMapIds.join(', ')}`);
      lines.push('');
      lines.push('| Map ID | Integration Test | Message |');
      lines.push('|--------|-----------------|---------|');
      for (const propagation of qualityReport.mapImpactScope.propagationStatus) {
        const status = propagation.integrationTestPassed ? 'PASS' : 'FAIL';
        lines.push(`| ${propagation.mapId} | ${status} | ${propagation.message ?? '-'} |`);
      }
    }
    lines.push('');
  }

  if (qualityReport.dedupCandidates && qualityReport.dedupCandidates.length > 0) {
    lines.push('## Dedup Candidates (Advisory)');
    lines.push('');
    lines.push('| Atom ID | Similarity | Semantic Fingerprint |');
    lines.push('|---------|-----------|---------------------|');
    for (const candidate of qualityReport.dedupCandidates) {
      lines.push(`| ${candidate.atomId} | ${((candidate.similarity ?? 0) * 100).toFixed(1)}% | ${candidate.semanticFingerprint ?? '-'} |`);
    }
    lines.push('');
  }

  if (qualityReport.dedupIgnoredAsPolymorph && qualityReport.dedupIgnoredAsPolymorph.length > 0) {
    lines.push('## Dedup Ignored As Polymorph');
    lines.push('');
    lines.push('| Atom ID | Reason |');
    lines.push('|---------|--------|');
    for (const ignored of qualityReport.dedupIgnoredAsPolymorph) {
      lines.push(`| ${ignored.atomId} | ${ignored.reason} |`);
    }
    lines.push('');
  }

  lines.push('## Conclusion');
  lines.push('');
  if (qualityReport.passed) {
    lines.push('All metrics within tolerance. Promote gate **passed**.');
  } else {
    const reasons: string[] = [];
    if (qualityReport.regressed) {
      reasons.push(`regressed metrics: ${qualityReport.regressedMetrics.join(', ')}`);
    }
    const mapFailed = qualityReport.mapImpactScope?.propagationStatus?.filter(
      (propagation: PropagationStatusRecord) => !propagation.integrationTestPassed
    ) ?? [];
    if (mapFailed.length > 0) {
      reasons.push(`failed map integrations: ${mapFailed.map((propagation) => propagation.mapId).join(', ')}`);
    }
    lines.push(`Promote gate **FAILED**. Reasons: ${reasons.join('; ')}.`);
  }
  lines.push('');

  return lines.join('\n');
}

function filterPolymorphDedupCandidates(candidates: DedupCandidateRecord[], polymorphContext: PolymorphContextRecord | null | undefined) {
  if (!polymorphContext || typeof polymorphContext !== 'object') {
    return { kept: candidates, ignored: [] };
  }

  const groupId = typeof polymorphContext.groupId === 'string' ? polymorphContext.groupId : '';
  const instanceAtomIds = Array.isArray(polymorphContext.instanceAtomIds)
    ? new Set(polymorphContext.instanceAtomIds.map((atomId) => String(atomId)))
    : new Set();

  const kept: DedupCandidateRecord[] = [];
  const ignored: DedupCandidateRecord[] = [];

  for (const candidate of candidates) {
    const candidateRecord = asRecord<DedupCandidateRecord>(candidate) ?? {};
    const atomId = String(candidateRecord.atomId || '');
    const candidateGroupId = typeof candidateRecord.polymorphGroupId === 'string' ? candidateRecord.polymorphGroupId : '';
    const ignoredByInstance = instanceAtomIds.has(atomId);
    const ignoredByGroup = Boolean(groupId) && candidateGroupId === groupId;

    if (ignoredByInstance || ignoredByGroup) {
      ignored.push({
        ...candidateRecord,
        ignoredAsPolymorph: true,
        reason: ignoredByInstance ? 'instance-atom' : 'same-polymorph-group'
      });
    } else {
      kept.push(candidateRecord);
    }
  }

  return { kept, ignored };
}
