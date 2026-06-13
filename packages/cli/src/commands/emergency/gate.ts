import { CliError } from '../shared.ts';
import { isTaskflowOperatorLaneActive } from './context.ts';
import { consumeEmergencyLease } from './leases.ts';
import type { EmergencyPermissionId } from './registry.ts';

export interface EmergencyGateInput {
  readonly cwd: string;
  readonly surface: string;
  readonly permission: EmergencyPermissionId;
  readonly taskId?: string | null;
  readonly actorId?: string | null;
  readonly emergencyApproval?: string | null;
  readonly flags?: readonly string[];
  readonly reason?: string | null;
  readonly command?: string | null;
  readonly allowTaskflowOperatorLane?: boolean;
}

export function assertEmergencyApproval(input: EmergencyGateInput) {
  if (input.allowTaskflowOperatorLane !== false && isTaskflowOperatorLaneActive()) {
    return null;
  }
  if (!input.emergencyApproval) {
    throw new CliError(
      'ATM_EMERGENCY_LANE_APPROVAL_REQUIRED',
      `${input.surface} is a protected backend emergency surface. Use taskflow open/close for normal work, or ask a human for an emergency approval lease and pass --emergency-approval <leaseId>.`,
      {
        exitCode: 1,
        details: {
          surface: input.surface,
          permission: input.permission,
          taskId: input.taskId ?? null,
          actorId: input.actorId ?? null,
          requiredCommand: `node atm.mjs emergency approve --permission ${input.permission} --actor ${input.actorId ?? '<actor>'}${input.taskId ? ` --task ${input.taskId}` : ''} --approval-text "<human approval sentence>" --reason "<why emergency backend is required>" --json`
        }
      }
    );
  }
  return consumeEmergencyLease({
    cwd: input.cwd,
    leaseId: input.emergencyApproval,
    permission: input.permission,
    surface: input.surface,
    taskId: input.taskId ?? null,
    actorId: input.actorId ?? null,
    flags: input.flags ?? [],
    reason: input.reason ?? null,
    command: input.command ?? null
  });
}
