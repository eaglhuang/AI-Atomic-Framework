export interface TelemetryTimingFields {
  readonly generatedAt?: string;
  readonly observedAt?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
}

export interface TelemetryCorrelationFields {
  readonly actorId?: string;
  readonly runId?: string;
  readonly correlationId?: string;
  readonly laneSessionId?: string | null;
  readonly taskId?: string | null;
  readonly batchId?: string | null;
  readonly waveId?: string | null;
}

export interface TelemetryObservationBase extends TelemetryTimingFields, TelemetryCorrelationFields {
  readonly schemaId?: string;
  readonly specVersion?: string;
  readonly source?: string;
}

export function normalizeTelemetryDurationMs(value: unknown): number | undefined {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.trunc(numeric);
}

