export interface TelemetryTimingFields {
    readonly generatedAt?: string;
    readonly observedAt?: string;
    readonly startedAt?: string;
    readonly finishedAt?: string;
    readonly durationMs?: number;
}
export type TelemetrySourceAvailability = 'available' | 'partial' | 'unavailable';
export type TelemetryStoragePolicy = 'runtime-raw-tracked-digest' | 'tracked-compact-digest' | 'runtime-only' | 'external-reference';
export type TelemetryObservationStatus = 'canonical' | 'adapter-backed' | 'legacy-readable' | 'not-yet-migrated';
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
    readonly schemaId: 'atm.telemetryObservation.v1';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none';
        readonly fromVersion: null;
        readonly notes: string;
    };
    readonly observationId: string;
    readonly producerId: string;
    readonly producerVersion: string;
    readonly observationKind: string;
    readonly status: TelemetryObservationStatus;
    readonly source: string;
    readonly sourceAvailability: TelemetrySourceAvailability;
    readonly storagePolicy: TelemetryStoragePolicy;
    readonly inputDigest?: string;
    readonly outputDigest?: string;
    readonly configDigest?: string;
    readonly cache?: {
        readonly key?: string;
        readonly hit?: boolean;
    };
    readonly extensions?: Readonly<Record<string, unknown>>;
}
export interface TelemetryObservationProducerInventoryEntry {
    readonly producerId: string;
    readonly ownerTaskId: string;
    readonly status: TelemetryObservationStatus;
    readonly sourcePaths: readonly string[];
    readonly adapterPort: string;
    readonly notes: string;
}
export declare const telemetryObservationProducerInventory: readonly TelemetryObservationProducerInventoryEntry[];
export declare function normalizeTelemetryDurationMs(value: unknown): number | undefined;
export declare function normalizeTelemetryTimestamp(value: unknown): string | undefined;
export declare function buildTelemetryObservation(input: {
    readonly observationId: string;
    readonly producerId: string;
    readonly producerVersion?: string;
    readonly observationKind: string;
    readonly status?: TelemetryObservationStatus;
    readonly source: string;
    readonly sourceAvailability?: TelemetrySourceAvailability;
    readonly storagePolicy?: TelemetryStoragePolicy;
    readonly timing?: TelemetryTimingFields;
    readonly correlation?: TelemetryCorrelationFields;
    readonly inputDigest?: string;
    readonly outputDigest?: string;
    readonly configDigest?: string;
    readonly cacheKey?: string;
    readonly cached?: boolean;
    readonly extensions?: Readonly<Record<string, unknown>>;
}): TelemetryObservationBase;
