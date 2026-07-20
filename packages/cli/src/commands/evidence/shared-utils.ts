import type { TelemetryObservationBase, TelemetryTimingFields } from '../../../../core/src/telemetry/observation.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isCommandRunProof(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.exitCode === 'number'
    && value.exitCode === 0
    && typeof value.stdoutSha256 === 'string'
    && value.stdoutSha256.length > 0
    && typeof value.stderrSha256 === 'string'
    && value.stderrSha256.length > 0;
}

export function quoteForShell(arg: string): string {
  if (/^[a-zA-Z0-9.\-_:/]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export interface CommandRunEvidenceInput extends TelemetryTimingFields {
  readonly command: string;
  readonly cwd?: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly validators?: readonly string[];
  readonly cached?: boolean;
  readonly cacheKey?: string;
  readonly runnerKind?: string;
  readonly sourceCommit?: string;
  readonly runnerVersion?: string;
  readonly stdoutPreview?: string;
  readonly stderrPreview?: string;
  readonly canonicalObservation?: TelemetryObservationBase;
}
