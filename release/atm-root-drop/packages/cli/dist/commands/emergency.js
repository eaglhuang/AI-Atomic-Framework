import path from 'node:path';
import { CliError, makeResult, message } from './shared.js';
import { createEmergencyLease, listEmergencyLeases, readEmergencyLease, revokeEmergencyLease } from './emergency/leases.js';
import { emergencyPermissionRegistry, listEmergencyPermissionIds } from './emergency/registry.js';
export async function runEmergency(argv) {
    const options = parseEmergencyOptions(argv);
    if (options.action === 'permissions') {
        return makeResult({
            ok: true,
            command: 'emergency',
            cwd: options.cwd,
            messages: [message('info', 'ATM_EMERGENCY_PERMISSIONS', 'Listed emergency permission registry.')],
            evidence: { permissions: emergencyPermissionRegistry }
        });
    }
    if (options.action === 'show') {
        const leases = options.leaseId
            ? [readEmergencyLease(options.cwd, options.leaseId)]
            : listEmergencyLeases(options.cwd);
        return makeResult({
            ok: true,
            command: 'emergency',
            cwd: options.cwd,
            messages: [message('info', 'ATM_EMERGENCY_SHOW', `Loaded ${leases.length} emergency approval lease(s).`)],
            evidence: { leases }
        });
    }
    if (options.action === 'revoke') {
        if (!options.leaseId) {
            throw new CliError('ATM_CLI_USAGE', 'emergency revoke requires --lease <lease-id>.', { exitCode: 2 });
        }
        if (!options.actorId) {
            throw new CliError('ATM_CLI_USAGE', 'emergency revoke requires --actor <actor-id>.', { exitCode: 2 });
        }
        const { lease, path: leasePath } = revokeEmergencyLease({
            cwd: options.cwd,
            leaseId: options.leaseId,
            actorId: options.actorId
        });
        return makeResult({
            ok: true,
            command: 'emergency',
            cwd: options.cwd,
            messages: [message('info', 'ATM_EMERGENCY_REVOKED', `Emergency approval lease revoked: ${lease.leaseId}.`)],
            evidence: { lease, leasePath }
        });
    }
    if (!options.actorId || !options.permission || !options.approvalText || !options.reason) {
        throw new CliError('ATM_CLI_USAGE', 'emergency approve requires --actor, --permission, --approval-text, and --reason.', {
            exitCode: 2,
            details: { permissions: listEmergencyPermissionIds() }
        });
    }
    const { lease, path: leasePath } = createEmergencyLease({
        cwd: options.cwd,
        taskId: options.taskId,
        actorId: options.actorId,
        permission: options.permission,
        approvedBy: options.approvedBy ?? 'human',
        approvalText: options.approvalText,
        reason: options.reason,
        surface: options.surface,
        allowedFlags: options.allowedFlags,
        ttlMinutes: options.ttlMinutes,
        maxUses: options.maxUses
    });
    return makeResult({
        ok: true,
        command: 'emergency',
        cwd: options.cwd,
        messages: [message('info', 'ATM_EMERGENCY_APPROVAL_CREATED', `Emergency approval lease created: ${lease.leaseId}.`)],
        evidence: { lease, leasePath }
    });
}
function parseEmergencyOptions(argv) {
    const state = {
        cwd: process.cwd(),
        action: null,
        taskId: null,
        actorId: null,
        approvedBy: null,
        permission: null,
        approvalText: null,
        reason: null,
        leaseId: null,
        surface: null,
        allowedFlags: [],
        ttlMinutes: null,
        maxUses: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--repo') {
            state.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--task') {
            state.taskId = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            state.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--approved-by') {
            state.approvedBy = requireValue(argv, index, '--approved-by');
            index += 1;
            continue;
        }
        if (arg === '--permission') {
            state.permission = requireValue(argv, index, '--permission');
            index += 1;
            continue;
        }
        if (arg === '--approval-text') {
            state.approvalText = requireValue(argv, index, '--approval-text');
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            state.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--lease' || arg === '--lease-id' || arg === '--emergency-approval') {
            state.leaseId = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--surface') {
            state.surface = requireValue(argv, index, '--surface');
            index += 1;
            continue;
        }
        if (arg === '--allowed-flag') {
            state.allowedFlags.push(requireAllowedFlagValue(argv, index));
            index += 1;
            continue;
        }
        if (arg === '--ttl-minutes') {
            state.ttlMinutes = parsePositiveInteger(requireValue(argv, index, '--ttl-minutes'), '--ttl-minutes');
            index += 1;
            continue;
        }
        if (arg === '--max-uses') {
            state.maxUses = parsePositiveInteger(requireValue(argv, index, '--max-uses'), '--max-uses');
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        if (arg.startsWith('--')) {
            throw new CliError('ATM_CLI_USAGE', `emergency does not support option ${arg}`, { exitCode: 2 });
        }
        if (state.action) {
            throw new CliError('ATM_CLI_USAGE', 'emergency accepts only one action.', { exitCode: 2 });
        }
        if (arg !== 'approve' && arg !== 'show' && arg !== 'revoke' && arg !== 'permissions') {
            throw new CliError('ATM_CLI_USAGE', 'emergency supports: approve, show, revoke, permissions.', { exitCode: 2 });
        }
        state.action = arg;
    }
    if (!state.action) {
        throw new CliError('ATM_CLI_USAGE', 'emergency supports: approve, show, revoke, permissions.', { exitCode: 2 });
    }
    return {
        ...state,
        cwd: path.resolve(state.cwd)
    };
}
function parsePositiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new CliError('ATM_CLI_USAGE', `emergency requires ${flag} to be a positive integer.`, { exitCode: 2 });
    }
    return parsed;
}
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `emergency requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
function requireAllowedFlagValue(argv, index) {
    const value = argv[index + 1];
    if (!value) {
        throw new CliError('ATM_CLI_USAGE', 'emergency requires a value for --allowed-flag', { exitCode: 2 });
    }
    return value;
}
