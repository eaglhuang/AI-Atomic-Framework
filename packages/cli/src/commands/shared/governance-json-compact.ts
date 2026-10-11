const CLAIM_EVIDENCE_OMIT = [
  'teamRecommendation',
  'integrationBootstrap',
  'runtimeAdapterReadiness',
  'planScopedPreflight',
  'dirtyWipAdmission',
  'oversizedExtractionAdmission',
  'claimLatency',
  'preClaimBrokerTransaction',
  'actorSession'
] as const;

const CLOSE_EVIDENCE_OMIT = [
  'closebackPlan',
  'governedCommitBundle',
  'residueDiagnosis',
  'delegationContract',
  'backendResult',
  'planningCardCloseback',
  'rosterCloseback',
  'observedTaskEvidence',
  'closebackPathResolution',
  'preCloseDeliveryCommit',
  'closeWriteTransaction',
  'brokerRuntimeCleanup',
  'deferredGovernanceDirty'
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slimPassingChecks(checks: unknown): unknown {
  if (!Array.isArray(checks)) return checks;
  return checks.map((check) => {
    if (!isRecord(check) || check.ok !== true) return check;
    return { name: check.name, ok: true };
  });
}

export function printedGovernanceJsonIsCompact(command: string): boolean {
  if (process.argv.includes('--verbose')) return false;
  const argv = process.argv;
  if (command === 'doctor' && argv.includes('doctor')) return true;
  if (command === 'next' && argv.includes('--claim')) return true;
  if ((command === 'taskflow close' || command === 'taskflow pre-close') && (argv.includes('close') || argv.includes('pre-close'))) return true;
  return false;
}

/**
 * Default printed envelope for claim, doctor, pre-close, and close.
 * Keeps commands, playbook, lane session, task ids, message codes,
 * diagnostics, failing doctor checks, and close blockers. `--verbose`
 * bypasses this and prints the full pretty envelope.
 */
export function compactPrintedGovernanceJson<T>(result: T): T {
  const copy = structuredClone(result) as T & { command?: string; evidence?: Record<string, unknown> };
  const evidence = isRecord(copy.evidence) ? copy.evidence : null;
  if (!evidence) return copy;
  if (Array.isArray(evidence.checks)) evidence.checks = slimPassingChecks(evidence.checks) as unknown[];
  const command = String(copy.command ?? '');
  const omit = command === 'next'
    ? CLAIM_EVIDENCE_OMIT
    : command === 'taskflow close' || command === 'taskflow pre-close'
      ? CLOSE_EVIDENCE_OMIT
      : [];
  for (const key of omit) delete evidence[key];
  evidence.compactOutput = {
    compacted: true,
    fullOutput: 'rerun the same command with --verbose --json'
  };
  return copy;
}
