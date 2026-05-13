export function evaluatePromotionGate(options: any = {}) {
  const lifecycleMode = options.lifecycleMode ?? 'birth';
  const reports = {
    nonRegression: normalizeGateReport(options.nonRegression),
    qualityComparison: normalizeGateReport(options.qualityComparison),
    registryCandidate: normalizeGateReport(options.registryCandidate)
  };
  const failed = Object.entries(reports)
    .filter(([, report]) => report.required && report.passed !== true)
    .map(([name]) => name);
  const canPromote = lifecycleMode === 'evolution' ? failed.length === 0 : true;
  return {
    lifecycleMode,
    canPromote,
    reports,
    failed
  };
}

export function validateRegistryConsistency(options: any = {}) {
  const gate = evaluatePromotionGate(options);
  const violations = gate.failed.map((name) => ({
    code: 'ATM_POLICE_PROMOTE_BLOCKED',
    severity: 'error',
    message: `Evolution promote gate blocked by ${name}.`
  }));
  return {
    checkId: options.checkId ?? 'registry-consistency',
    kind: 'registry-consistency',
    required: true,
    description: options.description ?? 'Validate registry candidate and promote gate consistency.',
    ok: violations.length === 0,
    canPromote: gate.canPromote,
    violations,
    gate
  };
}

function normalizeGateReport(report: any) {
  if (!report) {
    return { required: true, passed: false };
  }
  return {
    required: report.required !== false,
    passed: report.passed === true,
    reportId: report.reportId ?? null
  };
}
