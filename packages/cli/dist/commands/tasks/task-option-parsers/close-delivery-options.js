import path from 'node:path';
import { CliError } from '../../shared.js';
import { parseAllowStaleRunnerFlag, requireValue } from './helpers.js';
export function parseReconcileOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        deliveryCommit: '',
        // TASK-MEM-0007: cross-repo attestation parity with tasks close — a
        // planning-repo mirror of a card delivered in another repo must be able
        // to verify that delivery commit against its actual repo root.
        historicalDeliveryRepo: null,
        waiverOutOfScopeDelivery: false,
        waiverReason: null,
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
        if (arg === '--delivery-commit' || arg === '--historical-delivery') {
            options.deliveryCommit = requireValue(argv, index, arg);
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
        if (arg === '--reason') {
            options.waiverReason = requireValue(argv, index, '--reason');
            index += 1;
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
        throw new CliError('ATM_CLI_USAGE', `tasks reconcile does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks reconcile requires --task <work-item-id>.', { exitCode: 2 });
    }
    if (!options.deliveryCommit) {
        throw new CliError('ATM_CLI_USAGE', 'tasks reconcile requires --delivery-commit <commit-sha>.', { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        taskId: options.taskId.trim(),
        deliveryCommit: options.deliveryCommit.trim(),
        historicalDeliveryRepo: options.historicalDeliveryRepo ? path.resolve(options.historicalDeliveryRepo) : null,
        waiverReason: options.waiverReason?.trim() || null
    };
}
export function parseDeliverAndCloseOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        deliveryCommit: null,
        message: null,
        reason: null,
        dryRun: false,
        fromBatchCheckpoint: false,
        batchId: null
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
        if (arg === '--delivery-commit' || arg === '--historical-delivery') {
            options.deliveryCommit = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--message') {
            options.message = requireValue(argv, index, '--message');
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
        if (arg === '--from-batch-checkpoint') {
            options.fromBatchCheckpoint = true;
            continue;
        }
        if (arg === '--batch') {
            options.batchId = requireValue(argv, index, '--batch');
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks deliver-and-close does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks deliver-and-close requires --task <work-item-id>.', { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        taskId: options.taskId.trim()
    };
}
