import { recordCommandGateTelemetry as recordBaseTelemetry } from '../../telemetry/command-gate.js';
/** No diagnostic write may choose a fallback project during setup selection. */
export function recordCommandGateTelemetry(...args) {
    const [cwd, command, startedAt, result, argv = []] = args;
    if (command === 'setup') {
        if (!result.ok || argv.includes('--dry-run') || !result.cwd)
            return { ok: true, skipped: true };
        return recordBaseTelemetry(result.cwd, command, startedAt, result, argv);
    }
    return recordBaseTelemetry(cwd, command, startedAt, result, argv);
}
