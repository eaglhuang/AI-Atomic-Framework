import { commandGateCheckId, emitGateTelemetryEvent } from '../_vendor/core/dist/telemetry/index.js';
import { readFrameworkVersion } from '../commands/shared.js';
export function recordCommandGateTelemetry(cwd, commandName, startedAt, result, argv = []) {
    // Diagnostics must not violate a command's no-write dry-run contract.
    if (argv.includes('--dry-run'))
        return { ok: true, skipped: true };
    const option = (flag) => {
        const index = argv.indexOf(flag);
        const value = index >= 0 ? argv[index + 1] : argv.find(value => value.startsWith(`${flag}=`))?.slice(flag.length + 1);
        return value && !value.startsWith('--') ? value : null;
    };
    const error = result.messages?.find(entry => entry.level === 'error');
    const gateResult = result.ok ? 'pass' : error ? 'block'
        : result.messages?.some(entry => entry.level === 'warn') ? 'warn' : 'block';
    return emitGateTelemetryEvent(cwd, {
        gate: commandName, checkId: commandGateCheckId(commandName), result: gateResult,
        reasonClass: error?.code ?? gateResult, errorCode: error?.code ?? null,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        actorId: option('--actor') ?? undefined, taskId: option('--task'),
        command: commandName, runnerVersion: readFrameworkVersion(),
        workloadId: `cli-command:${commandName}`,
        source: process.env.NODE_ENV === 'test' || argv.includes('--emit-fixture') ? 'fixture' : 'runtime'
    });
}
