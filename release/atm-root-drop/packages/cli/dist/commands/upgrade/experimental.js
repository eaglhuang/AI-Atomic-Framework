/**
 * upgrade/experimental.ts
 *
 * TASK-ASR-0014 — upgrade.ts complete split
 *
 * Experimental API gating for the upgrade command.
 */
import path from 'node:path';
import { ExperimentalApiError, invokeExperimentalApi, listExperimentalApis } from '../../../../agent-pack-sdk/dist/experimental/index.js';
import { CliError, makeResult, message } from '../shared.js';
import { requireOptionValue } from './path-helpers.js';
export function firstExperimentalUpgradeAction(argv) {
    const flagsWithValues = new Set(['--cwd', '--api']);
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (flagsWithValues.has(argument)) {
            index += 1;
            continue;
        }
        if (argument === 'experimental-api') {
            return argument;
        }
    }
    return null;
}
export function runUpgradeExperimentalApi(argv) {
    const options = parseExperimentalApiOptions(argv);
    try {
        const result = invokeExperimentalApi({
            apiId: options.apiId,
            allowExperimental: options.allowExperimental,
            caller: 'atm upgrade experimental-api'
        });
        return makeResult({
            ok: true,
            command: 'upgrade',
            cwd: options.cwd,
            messages: [message('warning', 'ATM_EXPERIMENTAL_API_ALLOWED', 'Experimental API call allowed by explicit --allow-experimental opt-in.', {
                    apiId: result.apiId,
                    docs: 'docs/EXPERIMENTAL_API.md'
                })],
            evidence: {
                action: 'experimental-api',
                experimental: result,
                availableExperimentalApis: listExperimentalApis()
            }
        });
    }
    catch (error) {
        if (error instanceof ExperimentalApiError) {
            throw new CliError(error.code, error.message, {
                exitCode: 2,
                details: {
                    ...error.details,
                    availableExperimentalApis: listExperimentalApis()
                }
            });
        }
        throw error;
    }
}
// ─── Private helpers ───────────────────────────────────────────────────────
function parseExperimentalApiOptions(argv) {
    const options = {
        cwd: process.cwd(),
        apiId: 'agent-pack-preview',
        allowExperimental: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === 'experimental-api')
            continue;
        if (argument === '--cwd') {
            options.cwd = requireOptionValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (argument === '--api') {
            options.apiId = requireOptionValue(argv, index, '--api');
            index += 1;
            continue;
        }
        if (argument === '--allow-experimental') {
            options.allowExperimental = true;
            continue;
        }
        if (argument === '--json' || argument === '--pretty')
            continue;
        if (argument.startsWith('--')) {
            throw new CliError('ATM_CLI_USAGE', `upgrade experimental-api does not support option ${argument}`, { exitCode: 2 });
        }
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd)
    };
}
