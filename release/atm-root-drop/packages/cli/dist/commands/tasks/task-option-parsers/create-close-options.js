import path from 'node:path';
import { CliError } from '../../shared.js';
import { coerceStatus } from '../task-import-validators.js';
import { parseAllowStaleRunnerFlag, requireValue, uniqueStrings } from './helpers.js';
export function parseCreateOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        title: null,
        force: false
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
        if (arg === '--title') {
            options.title = requireValue(argv, index, '--title');
            index += 1;
            continue;
        }
        if (arg === '--force') {
            options.force = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks create does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks create requires --task <work-item-id>.', { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        taskId: options.taskId.trim()
    };
}
export function parseMirrorOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: null,
        actorId: null,
        provider: '',
        originTaskId: '',
        originUrl: null,
        title: null,
        status: 'planned',
        syncStatus: 'mirrored'
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
        if (arg === '--provider') {
            options.provider = requireValue(argv, index, '--provider');
            index += 1;
            continue;
        }
        if (arg === '--origin-task' || arg === '--origin-task-id') {
            options.originTaskId = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--origin-url') {
            options.originUrl = requireValue(argv, index, '--origin-url');
            index += 1;
            continue;
        }
        if (arg === '--title') {
            options.title = requireValue(argv, index, '--title');
            index += 1;
            continue;
        }
        if (arg === '--status') {
            options.status = coerceStatus(requireValue(argv, index, '--status'));
            index += 1;
            continue;
        }
        if (arg === '--sync-status') {
            options.syncStatus = requireValue(argv, index, '--sync-status');
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks mirror does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.provider) {
        throw new CliError('ATM_CLI_USAGE', 'tasks mirror requires --provider <id>.', { exitCode: 2 });
    }
    if (!options.originTaskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks mirror requires --origin-task <id>.', { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        provider: options.provider.trim(),
        originTaskId: options.originTaskId.trim(),
        taskId: options.taskId?.trim() || null
    };
}
export function parseHistoricalDeliveryRefs(value) {
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}
export function parseCloseOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        status: 'done',
        reason: null,
        fromBatchCheckpoint: false,
        batchId: null,
        historicalDeliveryRefs: [],
        historicalBatchRef: null,
        historicalDeliveryRepo: null,
        waiverOutOfScopeDelivery: false,
        emergencyApproval: null,
        allowStaleRunner: parseAllowStaleRunnerFlag(argv)
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
        if (arg === '--status') {
            const nextStatus = requireValue(argv, index, '--status').trim().toLowerCase();
            if (nextStatus !== 'done' && nextStatus !== 'review' && nextStatus !== 'blocked' && nextStatus !== 'abandoned') {
                throw new CliError('ATM_CLI_USAGE', 'tasks close --status supports only: done, review, blocked, abandoned.', { exitCode: 2 });
            }
            options.status = nextStatus;
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            options.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--from-batch-checkpoint') {
            options.fromBatchCheckpoint = true;
            continue;
        }
        if (arg === '--batch') {
            options.batchId = requireValue(argv, index, '--batch');
            index += 1;
            continue;
        }
        if (arg === '--historical-delivery' || arg === '--historical-delivery-commit' || arg === '--delivery-commit') {
            options.historicalDeliveryRefs.push(...parseHistoricalDeliveryRefs(requireValue(argv, index, arg)));
            index += 1;
            continue;
        }
        if (arg === '--historical-batch') {
            options.historicalBatchRef = requireValue(argv, index, '--historical-batch');
            index += 1;
            continue;
        }
        if (arg === '--historical-delivery-repo' || arg === '--delivery-repo' || arg === '--planning-delivery-repo') {
            options.historicalDeliveryRepo = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--waiver-out-of-scope-delivery' || arg === '--waive-out-of-scope') {
            options.waiverOutOfScopeDelivery = true;
            continue;
        }
        if (arg === '--emergency-approval') {
            options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty' || arg === '--allow-stale-runner') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks close does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks close requires --task <work-item-id>.', { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        taskId: options.taskId.trim(),
        historicalDeliveryRefs: uniqueStrings(options.historicalDeliveryRefs),
        historicalDeliveryRepo: options.historicalDeliveryRepo ? path.resolve(options.historicalDeliveryRepo) : null,
        reason: options.reason?.trim() || null
    };
}
