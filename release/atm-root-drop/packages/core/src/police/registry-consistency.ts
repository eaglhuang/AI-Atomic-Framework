interface GateReportRecord {
  readonly required?: boolean;
  readonly passed?: boolean;
  readonly reportId?: string | null;
}

interface PromotionGateOptions {
  readonly lifecycleMode?: string;
  readonly nonRegression?: unknown;
  readonly qualityComparison?: unknown;
  readonly registryCandidate?: unknown;
  readonly checkId?: string;
  readonly description?: string;
}

function asGateReportRecord(value: unknown): GateReportRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as GateReportRecord
    : null;
}

export function evaluatePromotionGate(options: PromotionGateOptions = {}) {
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

export function validateRegistryConsistency(options: PromotionGateOptions = {}) {
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

function normalizeGateReport(report: unknown) {
  const record = asGateReportRecord(report);
  if (!record) {
    return { required: true, passed: false };
  }
  return {
    required: record.required !== false,
    passed: record.passed === true,
    reportId: record.reportId ?? null
  };
}
