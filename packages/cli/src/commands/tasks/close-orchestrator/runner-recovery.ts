import { assertRunnerFreshForWriteAction } from '../../framework-development.ts';
import { assertEmergencyApproval } from '../../emergency/gate.ts';
import { recordStaleRunnerOverride, type EmergencyUseEvidence } from '../../tasks.ts';

export async function authorizeCloseRunnerRecovery(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly allowStaleRunner: boolean;
  readonly emergencyApproval: string | null;
  readonly reason: string | null;
}): Promise<EmergencyUseEvidence> {
  const staleGate = assertRunnerFreshForWriteAction({
    cwd: input.cwd,
    action: 'tasks-close',
    allowStaleRunner: input.allowStaleRunner
  });
  const emergencyUse = input.allowStaleRunner
    ? assertEmergencyApproval({
        cwd: input.cwd,
        surface: 'tasks close stale-runner recovery',
        permission: 'backend.runnerRecovery',
        taskId: input.taskId,
        actorId: input.actorId,
        emergencyApproval: input.emergencyApproval,
        flags: ['--allow-stale-runner'],
        reason: input.reason ?? 'Stale frozen runner recovery for a governed close.',
        command: `node atm.mjs tasks close --task ${input.taskId} --actor ${input.actorId} --allow-stale-runner --json`,
        // A batch operator lane replaces the normal close backend lease only.
        // Stale-runner recovery remains an explicit, consumed emergency action.
        allowTaskflowOperatorLane: false
      })
    : null;
  if (input.allowStaleRunner && staleGate.warning) {
    await recordStaleRunnerOverride({ cwd: input.cwd, taskId: input.taskId, actorId: input.actorId, action: 'tasks-close', command: `node atm.mjs tasks close --task ${input.taskId} --actor ${input.actorId} --allow-stale-runner --json` });
  }
  return emergencyUse;
}
