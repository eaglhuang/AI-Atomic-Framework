import path from 'node:path';
import { CliError } from '../../shared.js';
import { requireValue } from './helpers.js';
export function parseStatusOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        residueOnly: false
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
        if (arg === '--residue') {
            options.residueOnly = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty' || arg === '--allow-stale-runner') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks status does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks status requires --task <work-item-id>.', { exitCode: 2 });
    }
    return {
        cwd: path.resolve(options.cwd),
        taskId: options.taskId.trim(),
        residueOnly: options.residueOnly
    };
}
export function parseFinalizeDiagnoseOptions(argv) {
    const statusOptions = parseStatusOptions(argv);
    return statusOptions;
}
