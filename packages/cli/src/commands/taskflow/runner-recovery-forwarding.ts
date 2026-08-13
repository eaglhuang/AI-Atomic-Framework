export function buildTaskflowRunnerRecoveryArgs(input: {
  readonly runnerPublicationAccepted: boolean;
  readonly emergencyApproval: unknown;
}): readonly string[] {
  const leaseId = typeof input.emergencyApproval === 'string'
    ? input.emergencyApproval.trim()
    : '';

  // A valid human-approved recovery lease is itself the authority to forward
  // the protected flag. Do not require a second, unrelated publication
  // receipt: that split makes an issued recovery command unusable.
  if (!input.runnerPublicationAccepted && !leaseId) return [];

  return [
    ...(leaseId ? ['--emergency-approval', leaseId] : []),
    '--allow-stale-runner'
  ];
}
