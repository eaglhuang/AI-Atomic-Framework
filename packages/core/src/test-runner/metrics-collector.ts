export function createTestReportMetrics(input) {
  const normalizedInput = input || {};
  const total = normalizeNonNegativeInteger(normalizedInput.total ?? normalizedInput.totalCount);
  const failed = normalizeNonNegativeInteger(normalizedInput.failed ?? normalizedInput.failedCount);
  const latency = normalizeNonNegativeInteger(normalizedInput.latency ?? normalizedInput.durationMs ?? normalizedInput.propagationDuration);

  return {
    latency,
    errorRate: total > 0 ? failed / total : 0,
    coverage: normalizeCoverage(normalizedInput.coverage),
    edgeCaseCount: normalizeNonNegativeInteger(normalizedInput.edgeCaseCount)
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
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return 0;
}
