/**
 * ATM-2-0017: Regression Matrix Compare Gate
 *
 * 比較兩版 atom 的品質指標，執行不退轉檢查，
 * 產出 quality-comparison-report（含 mapImpactScope 和 Markdown 輸出）。
 */

/**
 * 預設的指標方向與容忍度設定。
 */
const DEFAULT_METRIC_CONFIG = {
  errorRate:      { direction: 'lower-is-better',  tolerance: 0 },
  coverage:       { direction: 'higher-is-better', tolerance: 0 },
  latency:        { direction: 'lower-is-better',  tolerance: 50 },
  edgeCaseCount:  { direction: 'higher-is-better', tolerance: 0 }
};

/**
 * 比較兩組 metrics，產出 quality-comparison-report。
 *
 * @param {object} options
 * @param {string} options.atomId
 * @param {string} options.fromVersion
 * @param {string} options.toVersion
 * @param {object} options.baselineMetrics - { errorRate, coverage, latency, edgeCaseCount, ... }
 * @param {object} options.currentMetrics
 * @param {object} [options.metricConfig] - 自訂指標方向/容忍度
 * @param {object} [options.mapImpactScope] - { affectedMapIds, propagationStatus }
 * @param {Array}  [options.dedupCandidates] - advisory dedup 候選
 * @param {object} [options.polymorphContext] - { groupId, instanceAtomIds }
 * @returns {object} 符合 quality-comparison-report.schema.json 的報告
 */
export function compareQualityMetrics(options) {
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

  // 收集所有出現在 baseline 或 current 中的指標名稱
  const allMetricNames = new Set([
    ...Object.keys(baselineMetrics),
    ...Object.keys(currentMetrics)
  ]);

  const metricDeltas = [];
  const regressedMetrics = [];

  for (const name of allMetricNames) {
    const baseline = baselineMetrics[name] ?? 0;
    const current = currentMetrics[name] ?? 0;
    const delta = current - baseline;
    const config = mergedConfig[name] ?? { direction: 'informational', tolerance: 0 };

    let passed = true;
    if (config.direction === 'lower-is-better') {
      // 退步 = current > baseline + tolerance
      passed = current <= baseline + (config.tolerance ?? 0);
    } else if (config.direction === 'higher-is-better') {
      // 退步 = current < baseline - tolerance
      passed = current >= baseline - (config.tolerance ?? 0);
    }
    // informational 永遠通過

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

  // 判斷 map integration 是否有失敗
  const mapFailed = mapImpactScope?.propagationStatus?.some(
    (p) => p.integrationTestPassed === false
  ) ?? false;

  const regressed = regressedMetrics.length > 0;
  const passed = !regressed && !mapFailed;

  const report = {
    schemaId: 'atm.police.qualityComparisonReport',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'Quality comparison for evolution gate.' },
    reportId: `police.quality-compare.${atomId.toLowerCase()}.${fromVersion}-to-${toVersion}`,
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

/**
 * 將 quality-comparison-report 轉為固定格式 Markdown。
 *
 * 模板：標題 / 指標表格 / mapImpactScope 區段 / dedupCandidates 區段 / 結論
 *
 * @param {object} report - quality-comparison-report JSON
 * @returns {string} Markdown 字串
 */
export function renderQualityReportMarkdown(report) {
  const lines = [];

  // 標題
  lines.push(`# Quality Comparison Report`);
  lines.push('');
  lines.push(`- **Atom**: ${report.atomId}`);
  lines.push(`- **From**: ${report.fromVersion} → **To**: ${report.toVersion}`);
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push(`- **Result**: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);
  lines.push('');

  // 指標表格
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Baseline | Current | Delta | Direction | Tolerance | Result |');
  lines.push('|--------|----------|---------|-------|-----------|-----------|--------|');
  for (const m of report.metrics) {
    const result = m.passed ? '✅' : '❌';
    const deltaStr = m.delta >= 0 ? `+${m.delta}` : `${m.delta}`;
    lines.push(`| ${m.name} | ${m.baseline} | ${m.current} | ${deltaStr} | ${m.direction} | ${m.tolerance ?? 0} | ${result} |`);
  }
  lines.push('');

  // mapImpactScope 區段
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
      for (const p of report.mapImpactScope.propagationStatus) {
        const status = p.integrationTestPassed ? '✅' : '❌';
        lines.push(`| ${p.mapId} | ${status} | ${p.message ?? '-'} |`);
      }
    }
    lines.push('');
  }

  // dedupCandidates 區段
  if (report.dedupCandidates && report.dedupCandidates.length > 0) {
    lines.push('## Dedup Candidates (Advisory)');
    lines.push('');
    lines.push('| Atom ID | Similarity | Semantic Fingerprint |');
    lines.push('|---------|-----------|---------------------|');
    for (const d of report.dedupCandidates) {
      lines.push(`| ${d.atomId} | ${(d.similarity * 100).toFixed(1)}% | ${d.semanticFingerprint ?? '-'} |`);
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

  // 結論
  lines.push('## Conclusion');
  lines.push('');
  if (report.passed) {
    lines.push('All metrics within tolerance. Promote gate **passed**.');
  } else {
    const reasons = [];
    if (report.regressed) {
      reasons.push(`regressed metrics: ${report.regressedMetrics.join(', ')}`);
    }
    const mapFailed = report.mapImpactScope?.propagationStatus?.filter(
      (p) => !p.integrationTestPassed
    );
    if (mapFailed?.length > 0) {
      reasons.push(`failed map integrations: ${mapFailed.map((p) => p.mapId).join(', ')}`);
    }
    lines.push(`Promote gate **FAILED**. Reasons: ${reasons.join('; ')}.`);
  }
  lines.push('');

  return lines.join('\n');
}

function filterPolymorphDedupCandidates(candidates, polymorphContext) {
  if (!polymorphContext || typeof polymorphContext !== 'object') {
    return { kept: candidates, ignored: [] };
  }

  const groupId = typeof polymorphContext.groupId === 'string' ? polymorphContext.groupId : '';
  const instanceAtomIds = Array.isArray(polymorphContext.instanceAtomIds)
    ? new Set(polymorphContext.instanceAtomIds.map((atomId) => String(atomId)))
    : new Set();

  const kept = [];
  const ignored = [];

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
