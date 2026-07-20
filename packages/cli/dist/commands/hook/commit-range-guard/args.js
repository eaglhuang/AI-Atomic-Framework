import path from 'node:path';
import { CliError } from '../../shared.js';
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `hook command requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
export function parseCommitRangeArgs(argv) {
    const state = {
        cwd: process.cwd(),
        base: null,
        head: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === 'commit-range') {
            continue;
        }
        if (arg === '--cwd' || arg === '--repo') {
            state.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--base') {
            state.base = requireValue(argv, index, '--base');
            index += 1;
            continue;
        }
        if (arg === '--head') {
            state.head = requireValue(argv, index, '--head');
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty')
            continue;
        throw new CliError('ATM_CLI_USAGE', `guard commit-range does not support argument ${arg}`, { exitCode: 2 });
    }
    if (!state.base || !state.head) {
        throw new CliError('ATM_CLI_USAGE', 'guard commit-range requires --base <ref> and --head <ref>.', { exitCode: 2 });
    }
    return {
        cwd: path.resolve(state.cwd),
        base: state.base,
        head: state.head
    };
}
