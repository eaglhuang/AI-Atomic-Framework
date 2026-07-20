import { CliError } from '../shared.js';
import { isTaskflowOperatorLaneActive } from './context.js';
import { consumeEmergencyLease } from './leases.js';
import { recordProtectedOverrideAuthorization, recordProtectedOverrideCompletion } from './protected-override-audit.js';
export function recordProtectedOverrideOutcome(input) {
    return recordProtectedOverrideCompletion({
        ...input,
        parentEventId: input.parentEventId
    });
}
function dedupeFlags(flags) {
    return Array.from(new Set(flags.filter((flag) => typeof flag === 'string' && flag.trim().length > 0)));
}
export function assertEmergencyApproval(input) {
    if (input.allowTaskflowOperatorLane !== false && isTaskflowOperatorLaneActive()) {
        return null;
    }
    if (!input.emergencyApproval) {
        const requiredAllowedFlags = dedupeFlags(input.flags ?? []);
        const allowedFlagArgs = requiredAllowedFlags.map((flag) => ` --allowed-flag ${flag}`).join('');
        throw new CliError('ATM_EMERGENCY_LANE_APPROVAL_REQUIRED', `${input.surface} is a protected backend emergency surface. Use taskflow open/close for normal work, or ask a human for an emergency approval lease and pass --emergency-approval <leaseId>.`
            + (requiredAllowedFlags.length > 0
                ? ` The blocked command already uses protected flag(s) ${requiredAllowedFlags.join(', ')}; include matching --allowed-flag entries on the first approve call or the lease will reject them with ATM_EMERGENCY_FLAG_NOT_APPROVED.`
                : ''), {
            exitCode: 1,
            details: {
                surface: input.surface,
                permission: input.permission,
                taskId: input.taskId ?? null,
                actorId: input.actorId ?? null,
                requiredAllowedFlags,
                requiredCommand: `node atm.mjs emergency approve --permission ${input.permission} --actor ${input.actorId ?? '<actor>'}${input.taskId ? ` --task ${input.taskId}` : ''}${allowedFlagArgs} --approval-text "<human approval sentence>" --reason "<why emergency backend is required>" --json`
            }
        });
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
