export function createTestReportMetrics(input = {}) {
  const total = normalizeNonNegativeInteger(input.total ?? input.totalCount);
  const failed = normalizeNonNegativeInteger(input.failed ?? input.failedCount);
  const latency = normalizeNonNegativeInteger(input.latency ?? input.durationMs ?? input.propagationDuration);

  return {
    latency,
    errorRate: total > 0 ? failed / total : 0,
    coverage: normalizeCoverage(input.coverage),
    edgeCaseCount: normalizeNonNegativeInteger(input.edgeCaseCount)
  };
}

function normalizeCoverage(value) {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function normalizeNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}