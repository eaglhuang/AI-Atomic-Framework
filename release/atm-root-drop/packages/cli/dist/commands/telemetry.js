import path from 'node:path';
import { getCommandSpec } from './command-specs.js';
import { makeResult, message, parseArgsForCommand } from './shared.js';
import { readTelemetryState, setTelemetryEnabled, telemetryConfigRelativePath } from '../telemetry/index.js';
export async function runTelemetry(argv) {
    const spec = getCommandSpec('telemetry');
    const parsed = parseArgsForCommand(spec, argv);
    const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
    const endpoint = typeof parsed.options.endpoint === 'string' ? String(parsed.options.endpoint) : null;
    const requestedOn = parsed.options.on === true;
    const requestedOff = parsed.options.off === true;
    let state = readTelemetryState(cwd);
    let code = 'ATM_TELEMETRY_STATUS';
    let text = state.enabled
        ? 'Telemetry is enabled for this repository.'
        : 'Telemetry is disabled for this repository.';
    if (requestedOn) {
        state = setTelemetryEnabled(cwd, true, endpoint);
        code = 'ATM_TELEMETRY_ENABLED';
        text = 'Telemetry opt-in saved for this repository.';
    }
    else if (requestedOff) {
        state = setTelemetryEnabled(cwd, false, endpoint);
        code = 'ATM_TELEMETRY_DISABLED';
        text = 'Telemetry opt-out saved for this repository.';
    }
    return makeResult({
        ok: true,
        command: 'telemetry',
        cwd,
        messages: [message('info', code, text)],
        evidence: {
            enabled: state.enabled,
            endpoint: state.endpoint,
            configPath: telemetryConfigRelativePath,
            allowedFields: state.allowedFields,
            docs: 'docs/TELEMETRY.md'
        }
    });
}
