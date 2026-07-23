import path from 'node:path';
import { CliError } from '../../shared.js';
import { normalizeRelativePath, requireValue } from './helpers.js';
export function parseResetOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        emergencyApproval: null,
        to: 'open',
        reason: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--repo') {
            options.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--task') {
            options.taskId = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            options.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--emergency-approval') {
            options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
            index += 1;
            continue;
        }
        if (arg === '--to') {
            options.to = requireValue(argv, index, '--to').trim().toLowerCase();
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            options.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty')
            continue;
        throw new CliError('ATM_CLI_USAGE', `tasks reset does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks reset requires --task <work-item-id>.', { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        taskId: options.taskId.trim()
    };
}
export function parseAuditOptions(argv) {
    const options = {
        cwd: process.cwd(),
        staged: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--repo') {
            options.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        if (arg === '--staged') {
            options.staged = true;
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks audit does not support option ${arg}`, { exitCode: 2 });
    }
    return {
        cwd: path.resolve(options.cwd),
        staged: options.staged
    };
}
export function parseQueueOptions(argv) {
    const options = {
        cwd: process.cwd(),
        queueId: null,
        actorId: null,
        reason: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--repo') {
            options.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--queue') {
            options.queueId = requireValue(argv, index, '--queue');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            options.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            options.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks queue does not support option ${arg}`, { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        queueId: options.queueId?.trim() || null
    };
}
export function parseLockCleanupOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        reason: null,
        emergencyApproval: null,
        allStale: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--repo') {
            options.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--task') {
            options.taskId = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            options.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--emergency-approval') {
            options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            options.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--all-stale') {
            options.allStale = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks lock cleanup does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId && !options.allStale) {
        throw new CliError('ATM_CLI_USAGE', 'tasks lock cleanup requires --task <work-item-id>.', { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        taskId: options.taskId.trim()
    };
}
export function parseLegacyLedgerMigrationOptions(argv) {
    const options = {
        cwd: process.cwd(),
        actorId: null,
        dryRun: false,
        apply: false,
        reason: 'Backfilled task-ledger/v1 baseline transition for legacy task state that predates CLI-controlled task transitions.'
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--repo') {
            options.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            options.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            options.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg === '--apply') {
            options.apply = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks migrate-legacy-ledger does not support option ${arg}`, { exitCode: 2 });
    }
    if (options.apply === options.dryRun) {
        throw new CliError('ATM_CLI_USAGE', 'tasks migrate-legacy-ledger requires exactly one of --dry-run or --apply.', { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd)
    };
}
export function parseClaimLifecycleOptions(action, argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        files: [],
        ttlSeconds: 1800,
        handoffTo: null,
        reason: null,
        reservedOk: false,
        // TASK-CID-0024: closeout-only / no-more-mutation claim intent. 'write' is
        // the normal mutating claim; 'closeout-only' is a non-mutating claim whose
        // deliverable already landed and only governed closeout work remains.
        claimIntent: 'write',
        autoIntent: false,
        claimIntentExplicit: false,
        wipCommit: false,
        discardWip: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            options.cwd = requireValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--task') {
            options.taskId = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            options.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--files') {
            options.files = requireValue(argv, index, '--files').split(',').map((entry) => normalizeRelativePath(entry)).filter(Boolean);
            index += 1;
            continue;
        }
        if (arg === '--ttl-seconds') {
            const raw = requireValue(argv, index, '--ttl-seconds');
            const ttl = Number.parseInt(raw, 10);
            if (!Number.isFinite(ttl) || ttl <= 0) {
                throw new CliError('ATM_CLI_USAGE', 'tasks requires --ttl-seconds to be a positive integer.', { exitCode: 2 });
            }
            options.ttlSeconds = ttl;
            index += 1;
            continue;
        }
        if (arg === '--to') {
            options.handoffTo = requireValue(argv, index, '--to');
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            options.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--reserved-ok') {
            options.reservedOk = true;
            continue;
        }
        if (arg === '--auto-intent') {
            if (action !== 'claim') {
                throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option --auto-intent`, { exitCode: 2 });
            }
            options.autoIntent = true;
            continue;
        }
        if (arg === '--closeout-only' || arg === '--no-more-mutation') {
            if (action !== 'claim') {
                throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option ${arg}`, { exitCode: 2 });
            }
            options.claimIntent = 'closeout-only';
            options.claimIntentExplicit = true;
            options.autoIntent = false;
            continue;
        }
        if (arg === '--wip-commit') {
            if (action !== 'release') {
                throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option --wip-commit`, { exitCode: 2 });
            }
            options.wipCommit = true;
            continue;
        }
        if (arg === '--discard-wip') {
            if (action !== 'release') {
                throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option --discard-wip`, { exitCode: 2 });
            }
            options.discardWip = true;
            continue;
        }
        if (arg === '--claim-intent') {
            if (action !== 'claim') {
                throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option --claim-intent`, { exitCode: 2 });
            }
            const raw = requireValue(argv, index, '--claim-intent').trim().toLowerCase();
            const normalized = raw === 'no-more-mutation' ? 'closeout-only' : raw;
            if (normalized !== 'write' && normalized !== 'closeout-only') {
                throw new CliError('ATM_CLI_USAGE', 'tasks claim requires --claim-intent to be one of: write, closeout-only, no-more-mutation.', {
                    exitCode: 2,
                    details: { claimIntent: raw, allowedValues: ['write', 'closeout-only', 'no-more-mutation'] }
                });
            }
            options.claimIntent = normalized;
            options.claimIntentExplicit = true;
            options.autoIntent = false;
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', `tasks ${action} requires --task <work-item-id>.`, { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        taskId: options.taskId.trim()
    };
}
