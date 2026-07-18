import path from 'node:path';
import { CliError } from '../shared.js';
import { lifecycleActions } from './types.js';
export function parseRouteArgs(argv) {
    const state = {
        cwd: process.cwd(),
        action: null,
        routeId: null,
        taskId: null,
        actorId: null,
        claimIntent: 'write',
        leaseId: null,
        ttlSeconds: 1800,
        maxSeconds: 7200,
        readSet: [],
        writeSet: [],
        targetAtomCids: [],
        targetVirtualAtomCids: [],
        patchEnvelopeRef: null,
        reason: null,
        admissionRechecked: false,
        mergePlanFile: null,
        proposalFile: null,
        stewardId: null,
        evidenceOutPath: null,
        scopeFiles: []
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            state.cwd = requireValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--route' || arg === '--route-id') {
            state.routeId = requireValue(argv, index, arg);
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
        if (arg === '--claim-intent') {
            state.claimIntent = parseClaimIntent(requireValue(argv, index, '--claim-intent'));
            index += 1;
            continue;
        }
        if (arg === '--lease-id') {
            state.leaseId = requireValue(argv, index, '--lease-id');
            index += 1;
            continue;
        }
        if (arg === '--ttl-seconds') {
            state.ttlSeconds = parsePositiveInteger(requireValue(argv, index, '--ttl-seconds'), '--ttl-seconds');
            index += 1;
            continue;
        }
        if (arg === '--max-seconds') {
            state.maxSeconds = parsePositiveInteger(requireValue(argv, index, '--max-seconds'), '--max-seconds');
            index += 1;
            continue;
        }
        if (arg === '--read-set') {
            state.readSet = parseCsv(requireValue(argv, index, '--read-set'));
            index += 1;
            continue;
        }
        if (arg === '--write-set') {
            state.writeSet = parseCsv(requireValue(argv, index, '--write-set'));
            index += 1;
            continue;
        }
        if (arg === '--atom-cids') {
            state.targetAtomCids = parseCsv(requireValue(argv, index, '--atom-cids'));
            index += 1;
            continue;
        }
        if (arg === '--virtual-atom-cids') {
            state.targetVirtualAtomCids = parseCsv(requireValue(argv, index, '--virtual-atom-cids'));
            index += 1;
            continue;
        }
        if (arg === '--patch-envelope-ref') {
            state.patchEnvelopeRef = requireValue(argv, index, '--patch-envelope-ref');
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            state.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--admission-rechecked') {
            state.admissionRechecked = true;
            continue;
        }
        if (arg === '--merge-plan-file') {
            state.mergePlanFile = requireValue(argv, index, '--merge-plan-file');
            index += 1;
            continue;
        }
        if (arg === '--proposal-file') {
            state.proposalFile = requireValue(argv, index, '--proposal-file');
            index += 1;
            continue;
        }
        if (arg === '--steward-id') {
            state.stewardId = requireValue(argv, index, '--steward-id');
            index += 1;
            continue;
        }
        if (arg === '--evidence-out-path') {
            state.evidenceOutPath = requireValue(argv, index, '--evidence-out-path');
            index += 1;
            continue;
        }
        if (arg === '--scope-files') {
            state.scopeFiles = parseCsv(requireValue(argv, index, '--scope-files'));
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        if (arg.startsWith('--')) {
            throw new CliError('ATM_CLI_USAGE', `route does not support option ${arg}`, { exitCode: 2 });
        }
        if (state.action) {
            throw new CliError('ATM_CLI_USAGE', 'route accepts only one action', { exitCode: 2 });
        }
        state.action = parseAction(arg);
    }
    if (!state.action) {
        throw new CliError('ATM_CLI_USAGE', 'route requires an action: open, status, list, pause, resume, abandon, handoff, or takeover.', { exitCode: 2 });
    }
    return {
        ...state,
        cwd: path.resolve(state.cwd),
        action: state.action
    };
}
function parseAction(value) {
    if (value === 'takeover' || lifecycleActions.has(value)) {
        return value;
    }
    throw new CliError('ATM_CLI_USAGE', 'route supports open, status, list, pause, resume, abandon, handoff, and takeover.', { exitCode: 2 });
}
function parseClaimIntent(value) {
    if (value === 'read' || value === 'write' || value === 'review' || value === 'steward' || value === 'release-sync') {
        return value;
    }
    throw new CliError('ATM_CLI_USAGE', `unsupported route claim intent: ${value}`, { exitCode: 2 });
}
function parsePositiveInteger(value, optionName) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new CliError('ATM_CLI_USAGE', `${optionName} must be a positive integer.`, { exitCode: 2 });
    }
    return parsed;
}
function parseCsv(value) {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}
function requireValue(argv, optionIndex, optionName) {
    const value = argv[optionIndex + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `route requires a value for ${optionName}`, { exitCode: 2 });
    }
    return value;
}
