import { recordCommandGateTelemetry as recordBaseTelemetry } from '../../telemetry/command-gate.ts';

/** No diagnostic write may choose a fallback project during setup selection. */
export function recordCommandGateTelemetry(...args: Parameters<typeof recordBaseTelemetry>) {
  const [cwd, command, startedAt, result, argv = []] = args;
  if (command === 'setup') {
    if (!result.ok || argv.includes('--dry-run') || !result.cwd) return { ok: true, skipped: true } as const;
    return recordBaseTelemetry(result.cwd, command, startedAt, result, argv);
  }
  return recordBaseTelemetry(cwd, command, startedAt, result, argv);
}
