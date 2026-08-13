import { CliError } from '../shared.ts';
import { isTaskflowOperatorLaneActive } from './context.ts';
import { assertEmergencyLeaseAvailable, consumeEmergencyLease, readEmergencyLease } from './leases.ts';
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
  readonly consume?: boolean;
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

function dedupeFlags(flags: readonly string[]): string[] {
  return Array.from(new Set(flags.filter((flag) => typeof flag === 'string' && flag.trim().length > 0)));
}

/**
 * Resolve which supplied lease authorizes this surface.
 *
 * A command can select more than one protected surface — closing a task under a
 * stale runner needs both runner recovery and the close itself — so the approval
 * argument carries a set: one id, or several separated by commas, in the same
 * shape `--paths` and `--scope` already use. Selection is the whole of this
 * function's authority. The selected lease is then validated exactly as a lone
 * lease always was, so nothing an operator must approve becomes optional, and a
 * lease is consumed only by the surface its own permission names.
 */
function selectLeaseForPermission(
  cwd: string,
  supplied: string,
  permission: EmergencyPermissionId
): string {
  const leaseIds = supplied.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (leaseIds.length <= 1) return supplied.trim();

  const carried = leaseIds.map((leaseId) => ({ leaseId, permission: readEmergencyLease(cwd, leaseId).permission }));
  const match = carried.find((entry) => entry.permission === permission);
  if (match) return match.leaseId;

  throw new CliError(
    'ATM_EMERGENCY_PERMISSION_MISMATCH',
    `No supplied emergency approval is for ${permission}. Supplied: ${carried.map((entry) => `${entry.leaseId} (${entry.permission})`).join(', ')}.`,
    {
      exitCode: 1,
      details: {
        requiredPermission: permission,
        suppliedLeases: carried
      }
    }
  );
}

export function assertEmergencyApproval(input: EmergencyGateInput) {
  if (input.allowTaskflowOperatorLane !== false && isTaskflowOperatorLaneActive()) {
    return null;
  }
  if (!input.emergencyApproval) {
    const requiredAllowedFlags = dedupeFlags(input.flags ?? []);
    const allowedFlagArgs = requiredAllowedFlags.map((flag) => ` --allowed-flag ${flag}`).join('');
    throw new CliError(
      'ATM_EMERGENCY_LANE_APPROVAL_REQUIRED',
      `${input.surface} is a protected backend emergency surface. Use taskflow open/close for normal work, or ask a human for an emergency approval lease and pass --emergency-approval <leaseId>.`
      + (requiredAllowedFlags.length > 0
        ? ` The blocked command already uses protected flag(s) ${requiredAllowedFlags.join(', ')}; include matching --allowed-flag entries on the first approve call or the lease will reject them with ATM_EMERGENCY_FLAG_NOT_APPROVED.`
        : ''),
      {
        exitCode: 1,
        details: {
          surface: input.surface,
          permission: input.permission,
          taskId: input.taskId ?? null,
          actorId: input.actorId ?? null,
          requiredAllowedFlags,
          requiredCommand: `node atm.mjs emergency approve --permission ${input.permission} --actor ${input.actorId ?? '<actor>'}${input.taskId ? ` --task ${input.taskId}` : ''}${allowedFlagArgs} --approval-text "<human approval sentence>" --reason "<why emergency backend is required>" --json`
        }
      }
    );
  }
  const leaseInput = {
    cwd: input.cwd,
    leaseId: selectLeaseForPermission(input.cwd, input.emergencyApproval, input.permission),
    permission: input.permission,
    surface: input.surface,
    taskId: input.taskId ?? null,
    actorId: input.actorId ?? null,
    flags: input.flags ?? [],
    reason: input.reason ?? null,
    command: input.command ?? null
  };
  if (input.consume === false) {
    return { lease: assertEmergencyLeaseAvailable(leaseInput), protectedOverrideAudit: null };
  }
  const consumed = consumeEmergencyLease(leaseInput);
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

/** A protected write surface cannot continue from a read-only lease check. */
export function requireConsumedEmergencyApproval(
  approval: ReturnType<typeof assertEmergencyApproval>,
) {
  if (!approval || !approval.protectedOverrideAudit || !('usePath' in approval)) {
    throw new CliError(
      'ATM_EMERGENCY_CONSUMPTION_REQUIRED',
      'Protected write requires a consumed emergency approval, not a read-only lease preflight.',
      { exitCode: 1 },
    );
  }
  return approval;
}
