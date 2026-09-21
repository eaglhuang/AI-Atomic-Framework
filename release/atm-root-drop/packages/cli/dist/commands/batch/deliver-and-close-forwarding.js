import { CliError } from '../shared.js';
const valueFlags = new Set([
    '--delivery-commit',
    '--historical-delivery',
    '--message',
    '--reason',
    '--emergency-approval'
]);
export function parseBatchDeliverAndCloseExtras(argv) {
    let deliveryCommit = null;
    let deliveryMessage = null;
    let reason = null;
    let emergencyApproval = null;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!valueFlags.has(arg))
            continue;
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
            throw new CliError('ATM_CLI_USAGE', `batch deliver-and-close ${arg} requires a value.`, { exitCode: 2 });
        }
        index += 1;
        if (arg === '--delivery-commit' || arg === '--historical-delivery')
            deliveryCommit = value;
        if (arg === '--message')
            deliveryMessage = value;
        if (arg === '--reason')
            reason = value;
        if (arg === '--emergency-approval')
            emergencyApproval = value.trim();
    }
    return { deliveryCommit, deliveryMessage, reason, emergencyApproval };
}
export function stripBatchDeliverAndCloseExtras(argv) {
    const stripped = [];
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (valueFlags.has(arg)) {
            index += 1;
            continue;
        }
        stripped.push(arg);
    }
    return stripped;
}
export function buildBatchDeliverAndCloseArgs(cwd, taskId, actorId, batchId, extras) {
    const args = [
        'deliver-and-close', '--cwd', cwd, '--task', taskId, '--actor', actorId,
        '--from-batch-checkpoint', '--batch', batchId, '--json'
    ];
    if (extras.deliveryCommit)
        args.push('--delivery-commit', extras.deliveryCommit);
    if (extras.deliveryMessage)
        args.push('--message', extras.deliveryMessage);
    if (extras.reason)
        args.push('--reason', extras.reason);
    if (extras.emergencyApproval)
        args.push('--emergency-approval', extras.emergencyApproval);
    return args;
}
