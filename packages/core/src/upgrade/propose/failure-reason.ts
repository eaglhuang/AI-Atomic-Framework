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

interface QualityReport {
  regressedMetrics?: string[];
  mapImpactScope?: {
    propagationStatus?: Array<{ integrationTestPassed?: boolean; mapId?: string }>;
  };
}

export function gateFailureSummary(gateName: string, report: QualityReport | null | undefined): string {
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

export function qualityComparisonFailureReason(report: QualityReport | null | undefined): string {
  if (Array.isArray(report?.regressedMetrics) && report!.regressedMetrics!.length > 0) {
    return `regressed metrics: ${report!.regressedMetrics!.join(', ')}`;
  }
  const failedMaps = report?.mapImpactScope?.propagationStatus?.filter((entry) => entry.integrationTestPassed === false) ?? [];
  if (failedMaps.length > 0) {
    return `failed map integrations: ${failedMaps.map((entry) => entry.mapId).join(', ')}`;
  }
  return 'quality metrics failed';
}
