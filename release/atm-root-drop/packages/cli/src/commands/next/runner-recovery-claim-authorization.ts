import { assertEmergencyApproval } from '../emergency/gate.ts';
import { assertSourceFirstRunnerReadOnlyAction } from '../framework-development.ts';

export function assertClaimRunnerWriteAuthority(input: {
  readonly cwd: string;
  readonly actorId: string | null;
  readonly allowStaleRunner: boolean;
  readonly emergencyApproval: string | null;
}) {
  if (!input.allowStaleRunner) {
    assertSourceFirstRunnerReadOnlyAction({ cwd: input.cwd, action: 'next --claim' });
    return;
  }
  assertEmergencyApproval({
    cwd: input.cwd,
    surface: 'next --claim runner recovery',
    permission: 'backend.runnerRecovery',
    actorId: input.actorId,
    emergencyApproval: input.emergencyApproval,
    flags: ['--allow-stale-runner'],
    reason: 'Runner-recovery claim requires an explicit human-approved lease.',
    command: 'node atm.mjs next --claim --allow-stale-runner --json',
    allowTaskflowOperatorLane: false
  });
}

export function assertRunnerRecoveryClaimPreflight(input: {
  readonly cwd: string;
  readonly actorId: string | null;
  readonly allowStaleRunner: boolean;
  readonly emergencyApproval: string | null;
}): boolean {
  if (!input.allowStaleRunner) return false;
  assertEmergencyApproval({
    cwd: input.cwd, surface: 'next --claim runner recovery', permission: 'backend.runnerRecovery',
    actorId: input.actorId, emergencyApproval: input.emergencyApproval, flags: ['--allow-stale-runner'],
    reason: 'Runner-recovery claim requires an explicit human-approved lease.',
    command: 'node atm.mjs next --claim --allow-stale-runner --json', allowTaskflowOperatorLane: false, consume: false
  });
  return true;
}
