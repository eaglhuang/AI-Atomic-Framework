import { CliError } from '../shared.ts';
import { isTaskflowOperatorLaneActive } from './context.ts';
import { consumeEmergencyLease } from './leases.ts';
import {
  recordProtectedOverrideAuthorization,
  recordProtectedOverrideCompletion,
  type ProtectedOverrideRepairCandidate
} from './protected-override-audit.ts';
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

export function recordProtectedOverrideOutcome(input: {
  readonly cwd: string;
  readonly parentEventId: string;
  readonly actorId: string | null;
  readonly taskId: string | null;
  readonly surface: string;
  readonly command: string | null;
  readonly flags?: readonly string[];
  readonly permission?: EmergencyPermissionId | string | null;
  readonly leaseId?: string | null;
  readonly reason?: string | null;
  readonly skippedChecks?: readonly string[];
  readonly touchedFiles?: readonly string[];
  readonly outcome: 'succeeded' | 'failed';
  readonly failureCode?: string | null;
  readonly emergencyUsePath?: string | null;
  readonly repairCandidate?: ProtectedOverrideRepairCandidate | null;
}) {
  return recordProtectedOverrideCompletion({
    ...input,
    parentEventId: input.parentEventId
  });
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
  const consumed = consumeEmergencyLease({
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
  const protectedOverrideAudit = recordProtectedOverrideAuthorization({
    cwd: input.cwd,
    actorId: input.actorId ?? null,
    taskId: input.taskId ?? null,
    surface: input.surface,
    command: input.command ?? null,
    flags: input.flags ?? [],
    permission: input.permission,
    leaseId: input.emergencyApproval ?? null,
    reason: input.reason ?? null,
    skippedChecks: ['protected-backend-surface', input.permission],
    touchedFiles: [],
    emergencyUsePath: consumed.usePath
  });
  return {
    ...consumed,
    protectedOverrideAudit
  };
}
