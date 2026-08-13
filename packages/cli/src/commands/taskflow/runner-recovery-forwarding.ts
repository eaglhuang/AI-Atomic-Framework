export function buildTaskflowRunnerRecoveryArgs(input: {
  readonly runnerPublicationAccepted: boolean;
  readonly emergencyApproval: unknown;
}): readonly string[] {
  if (!input.runnerPublicationAccepted) return [];

  const leaseId = typeof input.emergencyApproval === 'string'
    ? input.emergencyApproval.trim()
    : '';

  return [
    ...(leaseId ? ['--emergency-approval', leaseId] : []),
    '--allow-stale-runner'
  ];
}
