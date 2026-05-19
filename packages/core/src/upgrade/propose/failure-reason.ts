/**
 * Gate failure-reason renderers for upgrade proposals.
 *
 * Extracted from `packages/core/src/upgrade/propose.ts` per the
 * `propose.SPLIT_PLAN.md` Layer 3 split. Two small string-rendering
 * helpers — the lowest-coupling slice of propose.ts.
 *
 * Surface contract: the returned strings are embedded in upgrade
 * proposal JSON (invariant I2) and surface in CLI output. Behavior
 * preserved byte-for-byte.
 */

export function gateFailureSummary(gateName: any, report: any) {
  switch (gateName) {
    case 'nonRegression':
      return 'baseline fixtures failed';
    case 'qualityComparison':
      return qualityComparisonFailureReason(report);
    case 'registryCandidate':
      return 'candidate cannot promote';
    default:
      return 'gate failed';
  }
}

export function qualityComparisonFailureReason(report: any) {
  if (Array.isArray(report?.regressedMetrics) && report.regressedMetrics.length > 0) {
    return `regressed metrics: ${report.regressedMetrics.join(', ')}`;
  }
  const failedMaps = report?.mapImpactScope?.propagationStatus?.filter((entry: any) => entry.integrationTestPassed === false) ?? [];
  if (failedMaps.length > 0) {
    return `failed map integrations: ${failedMaps.map((entry: any) => entry.mapId).join(', ')}`;
  }
  return 'quality metrics failed';
}
