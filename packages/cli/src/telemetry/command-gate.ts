import { commandGateCheckId, emitGateTelemetryEvent, type GateTelemetryResult } from '../../../core/src/telemetry/index.ts';
import { readFrameworkVersion } from '../commands/shared.ts';

export function recordCommandGateTelemetry(
  cwd: string, commandName: string, startedAt: bigint,
  result: { readonly ok: boolean; readonly cwd?: string; readonly messages?: readonly { readonly level?: string; readonly code?: string }[] },
  argv: readonly string[] = []
) {
  // Diagnostics must not violate a command's no-write dry-run contract.
  if (argv.includes('--dry-run')) return { ok: true, skipped: true } as const;
  const option = (flag: string) => {
    const index = argv.indexOf(flag);
    const value = index >= 0 ? argv[index + 1] : argv.find(value => value.startsWith(`${flag}=`))?.slice(flag.length + 1);
    return value && !value.startsWith('--') ? value : null;
  };
  const error = result.messages?.find(entry => entry.level === 'error');
  const gateResult: GateTelemetryResult = result.ok ? 'pass' : error ? 'block'
    : result.messages?.some(entry => entry.level === 'warn') ? 'warn' : 'block';
  return emitGateTelemetryEvent(result.cwd || option('--cwd') || cwd, {
    gate: commandName, checkId: commandGateCheckId(commandName), result: gateResult,
    reasonClass: error?.code ?? gateResult, errorCode: error?.code ?? null,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    actorId: option('--actor') ?? undefined, taskId: option('--task'),
    command: commandName, runnerVersion: readFrameworkVersion(),
    workloadId: `cli-command:${commandName}`,
    source: process.env.NODE_ENV === 'test' || argv.includes('--emit-fixture') ? 'fixture' : 'runtime'
  });
}
