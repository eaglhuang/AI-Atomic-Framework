import path from 'node:path';
import { probeProject } from '../_vendor/core/dist/guidance/index.js';
import { getCommandSpec } from './command-specs.js';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.js';
export function runOrient(argv = []) {
    const spec = getCommandSpec('orient');
    if (!spec) {
        throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for orient.', { exitCode: 2 });
    }
    const parsed = parseArgsForCommand(spec, argv);
    const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
    const orientation = probeProject(cwd);
    const full = parsed.options.full === true;
    const compactLimit = 8;
    const projectedOrientation = full || orientation.testEntrypoints.length <= compactLimit
        ? orientation
        : {
            ...orientation,
            testEntrypoints: orientation.testEntrypoints.slice(0, compactLimit),
            testEntrypointsTruncated: true,
            testEntrypointsTotalCount: orientation.testEntrypoints.length,
            testEntrypointsInventoryMode: 'compact'
        };
    return makeResult({
        ok: true,
        command: 'orient',
        cwd,
        messages: [message('info', 'ATM_GUIDANCE_ORIENTATION_READY', 'Project orientation report is ready.', { repositoryRoot: orientation.repositoryRoot })],
        evidence: {
            orientation: projectedOrientation
        }
    });
}
