/**
 * ATM-2-0017: Regression Matrix Compare Gate
 *
 * Compare two revisions of atom quality metrics and produce
 * a quality-comparison report with optional map impact scope
 * and advisory dedup sections.
 */

const DEFAULT_METRIC_CONFIG = {
  errorRate: { direction: 'lower-is-better', tolerance: 0 },
  coverage: { direction: 'higher-is-better', tolerance: 0 },
  latency: { direction: 'lower-is-better', tolerance: 50 },
  edgeCaseCount: { direction: 'higher-is-better', tolerance: 0 }
};

export function compareQualityMetrics(options: any) {
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
  } = options;

  const mergedConfig = { ...DEFAULT_METRIC_CONFIG, ...metricConfig };
  const allMetricNames = new Set([
    ...Object.keys(baselineMetrics),
    ...Object.keys(currentMetrics)
  ]);

  const metricDeltas: any[] = [];
  const regressedMetrics: string[] = [];

  for (const name of allMetricNames) {
    const baseline = baselineMetrics[name] ?? 0;
    const current = currentMetrics[name] ?? 0;
    const delta = current - baseline;
    const config = mergedConfig[name] ?? { direction: 'informational', tolerance: 0 };

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
      direction: config.direction,
      tolerance: config.tolerance ?? 0,
      passed
    });
  }

  const mapFailed = mapImpactScope?.propagationStatus?.some(
    (status: any) => status.integrationTestPassed === false
  ) ?? false;

  const regressed = regressedMetrics.length > 0;
  const passed = !regressed && !mapFailed;

  const report: any = {
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
    atomId,
    fromVersion,
    toVersion,
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

export function renderQualityReportMarkdown(report: any) {
  const lines: string[] = [];

  lines.push('# Quality Comparison Report');
  lines.push('');
  lines.push(`- **Atom**: ${report.atomId}`);
  lines.push(`- **From**: ${report.fromVersion} -> **To**: ${report.toVersion}`);
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push(`- **Result**: ${report.passed ? 'PASSED' : 'FAILED'}`);
  lines.push('');

  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Baseline | Current | Delta | Direction | Tolerance | Result |');
  lines.push('|--------|----------|---------|-------|-----------|-----------|--------|');
  for (const metric of report.metrics) {
    const result = metric.passed ? 'PASS' : 'FAIL';
    const deltaStr = metric.delta >= 0 ? `+${metric.delta}` : `${metric.delta}`;
    lines.push(`| ${metric.name} | ${metric.baseline} | ${metric.current} | ${deltaStr} | ${metric.direction} | ${metric.tolerance ?? 0} | ${result} |`);
  }
  lines.push('');

  if (report.mapImpactScope) {
    lines.push('## Map Impact Scope');
    lines.push('');
    if (report.mapImpactScope.affectedMapIds.length === 0) {
      lines.push('No maps affected.');
    } else {
      lines.push(`Affected maps: ${report.mapImpactScope.affectedMapIds.join(', ')}`);
      lines.push('');
      lines.push('| Map ID | Integration Test | Message |');
      lines.push('|--------|-----------------|---------|');
      for (const propagation of report.mapImpactScope.propagationStatus) {
        const status = propagation.integrationTestPassed ? 'PASS' : 'FAIL';
        lines.push(`| ${propagation.mapId} | ${status} | ${propagation.message ?? '-'} |`);
      }
    }
    lines.push('');
  }

  if (report.dedupCandidates && report.dedupCandidates.length > 0) {
    lines.push('## Dedup Candidates (Advisory)');
    lines.push('');
    lines.push('| Atom ID | Similarity | Semantic Fingerprint |');
    lines.push('|---------|-----------|---------------------|');
    for (const candidate of report.dedupCandidates) {
      lines.push(`| ${candidate.atomId} | ${(candidate.similarity * 100).toFixed(1)}% | ${candidate.semanticFingerprint ?? '-'} |`);
    }
    lines.push('');
  }

  if (report.dedupIgnoredAsPolymorph && report.dedupIgnoredAsPolymorph.length > 0) {
    lines.push('## Dedup Ignored As Polymorph');
    lines.push('');
    lines.push('| Atom ID | Reason |');
    lines.push('|---------|--------|');
    for (const ignored of report.dedupIgnoredAsPolymorph) {
      lines.push(`| ${ignored.atomId} | ${ignored.reason} |`);
    }
    lines.push('');
  }

  lines.push('## Conclusion');
  lines.push('');
  if (report.passed) {
    lines.push('All metrics within tolerance. Promote gate **passed**.');
  } else {
    const reasons: string[] = [];
    if (report.regressed) {
      reasons.push(`regressed metrics: ${report.regressedMetrics.join(', ')}`);
    }
    const mapFailed = report.mapImpactScope?.propagationStatus?.filter(
      (propagation: any) => !propagation.integrationTestPassed
    );
    if (mapFailed?.length > 0) {
      reasons.push(`failed map integrations: ${mapFailed.map((propagation: any) => propagation.mapId).join(', ')}`);
    }
    lines.push(`Promote gate **FAILED**. Reasons: ${reasons.join('; ')}.`);
  }
  lines.push('');

  return lines.join('\n');
}

function filterPolymorphDedupCandidates(candidates: any, polymorphContext: any) {
  if (!polymorphContext || typeof polymorphContext !== 'object') {
    return { kept: candidates, ignored: [] };
  }

  const groupId = typeof polymorphContext.groupId === 'string' ? polymorphContext.groupId : '';
  const instanceAtomIds = Array.isArray(polymorphContext.instanceAtomIds)
    ? new Set(polymorphContext.instanceAtomIds.map((atomId: any) => String(atomId)))
    : new Set();

  const kept: any[] = [];
  const ignored: any[] = [];

  for (const candidate of candidates) {
    const atomId = String(candidate?.atomId || '');
    const candidateGroupId = typeof candidate?.polymorphGroupId === 'string' ? candidate.polymorphGroupId : '';
    const ignoredByInstance = instanceAtomIds.has(atomId);
    const ignoredByGroup = Boolean(groupId) && candidateGroupId === groupId;

    if (ignoredByInstance || ignoredByGroup) {
      ignored.push({
        ...candidate,
        ignoredAsPolymorph: true,
        reason: ignoredByInstance ? 'instance-atom' : 'same-polymorph-group'
      });
    } else {
      kept.push(candidate);
    }
  }

  return { kept, ignored };
}
