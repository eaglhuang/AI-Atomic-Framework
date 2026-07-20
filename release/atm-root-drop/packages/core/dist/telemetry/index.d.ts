import type { TelemetryCorrelationFields, TelemetryTimingFields } from './observation.ts';
export type { TelemetryCorrelationFields, TelemetryObservationBase, TelemetryObservationStatus, TelemetrySourceAvailability, TelemetryStoragePolicy, TelemetryTimingFields } from './observation.ts';
export { buildTelemetryObservation, normalizeTelemetryDurationMs, normalizeTelemetryTimestamp, telemetryObservationProducerInventory } from './observation.ts';
export declare const gateTelemetrySpecVersion = "atm.gateTelemetry.v1";
export declare const gateTelemetryRuntimeRelativePath: string;
export declare const gateTelemetryHistoryRelativePath: string;
export declare const gateTelemetryEvidenceRelativePath: string;
export type GateTelemetryResult = 'pass' | 'block' | 'warn' | 'skip' | 'error';
export interface GateCheckRegistryEntry {
    readonly checkId: string;
    readonly checkVersion: string;
    readonly gate: string;
    readonly owner: string;
    readonly summary: string;
}
export type GateTelemetryCoverageStatus = 'instrumented' | 'read-only-summary' | 'out-of-scope' | 'not-yet-covered';
export type GateTelemetrySourceAvailability = 'available' | 'unavailable' | 'partial';
export type GateTelemetryM2PreflightVerdict = 'ready' | 'inconclusive' | 'blocked';
export interface GateTelemetryRequiredNodeCoverage {
    readonly nodeId: string;
    readonly nodeFamily: string;
    readonly coverageStatus: GateTelemetryCoverageStatus;
    readonly producerCheckIds: readonly string[];
    readonly consumerIds: readonly string[];
    readonly requiredCorrelationKeys: readonly string[];
    readonly missingCorrelationKeys: readonly string[];
    readonly sourceAvailability: GateTelemetrySourceAvailability;
    readonly missingTelemetry: readonly string[];
    readonly m2Comparable: boolean;
}
export interface GateTelemetryRegistryCoverageReport {
    readonly schemaId: 'atm.gateTelemetryRegistryCoverageReport.v1';
    readonly generatedAt: string;
    readonly configDigest: string;
    readonly historyDigest: string;
    readonly requiredNodes: readonly GateTelemetryRequiredNodeCoverage[];
    readonly droppedEvents: number;
    readonly malformedEvents: number;
    readonly m2Comparable: boolean;
    readonly m2PreflightVerdict: GateTelemetryM2PreflightVerdict;
    readonly rawDataPolicy: {
        readonly runtimeStorage: '.atm/runtime/telemetry/**';
        readonly trackedEvidence: 'compact-digest-only';
        readonly rawTelemetryCommitted: false;
    };
}
export interface GateTelemetryTaskSummary {
    readonly schemaId: 'atm.gateTelemetryTaskSummary.v1';
    readonly taskId: string;
    readonly generatedAt: string;
    readonly window: {
        readonly start: string | null;
        readonly end: string | null;
        readonly watermark: string | null;
    };
    readonly correlation: {
        readonly runIds: readonly string[];
        readonly laneSessionIds: readonly string[];
        readonly batchIds: readonly string[];
        readonly waveIds: readonly string[];
    };
    readonly gateEvents: GateTelemetryReport['byCheckId'];
    readonly uniqueBlocks: readonly string[];
    readonly truePositiveStatus: 'unclassified' | 'classified';
    readonly evidenceReadbacks: number;
    readonly warnings: readonly string[];
    readonly droppedEvents: number;
    readonly missingTelemetry: readonly string[];
    readonly baselineOrTreatmentRole: 'baseline' | 'treatment' | 'm2-preflight' | 'unknown';
    readonly sourceAvailability: GateTelemetrySourceAvailability;
    readonly historyDigest: string;
    readonly configDigest: string;
    readonly inputDigest: string;
    readonly sealedDigest: string;
}
export interface GateTelemetryEvent extends Required<Pick<TelemetryTimingFields, 'observedAt' | 'durationMs'>>, Required<Pick<TelemetryCorrelationFields, 'actorId' | 'runId' | 'correlationId'>> {
    readonly specVersion: typeof gateTelemetrySpecVersion;
    readonly eventId: string;
    readonly sequence: number;
    readonly gate: string;
    readonly checkId: string;
    readonly checkVersion: string;
    readonly policyVersion: string;
    readonly eligible: boolean;
    readonly result: GateTelemetryResult;
    readonly reasonClass: string;
    readonly laneSessionId?: string | null;
    readonly taskId?: string | null;
    readonly batchId?: string | null;
    readonly waveId?: string | null;
    readonly command: string;
    readonly inputDigest: string;
    readonly configDigest: string;
    readonly source: 'runtime' | 'fixture' | 'classification';
    readonly redactionClass: 'none' | 'path-redacted' | 'secret-redacted';
    readonly failureEnvelopeRef?: string | null;
    readonly evidenceReadRef?: string | null;
}
export interface GateTelemetryMetaHealth {
    readonly droppedEvents: number;
    readonly malformedEvents: number;
    readonly warnings: readonly string[];
}
export interface GateTelemetrySealDigest {
    readonly schemaId: 'atm.gateTelemetrySealDigest.v1';
    readonly taskId: string;
    readonly windowId: string;
    readonly sealedAt: string;
    readonly watermark: string;
    readonly eventCount: number;
    readonly storagePolicy: 'runtime-raw-tracked-digest';
    readonly sourceAvailability: GateTelemetrySourceAvailability;
    readonly runtimeLocator: {
        readonly root: '.atm/runtime/telemetry/gate-events';
        readonly watermark: string;
        readonly source: 'local-runtime';
    };
    readonly historyPath: string;
    readonly historyDigest: string;
    readonly rawEventDigest: string;
    readonly aggregates: GateTelemetryReport['byCheckId'];
    readonly correlation: GateTelemetryTaskSummary['correlation'];
    readonly uniqueBlocks: readonly string[];
    readonly evidenceReadbacks: number;
    readonly metaHealth: GateTelemetryMetaHealth;
}
export interface GateTelemetryReport {
    readonly schemaId: 'atm.gateTelemetryReport.v1';
    readonly generatedAt: string;
    readonly source: 'sealed-history' | 'sealed-history+runtime';
    readonly eventCount: number;
    readonly byCheckId: Record<string, {
        readonly eligible: number;
        readonly resultCounts: Record<string, number>;
        readonly durationP50: number | null;
        readonly durationP95: number | null;
        readonly evidenceReadbacks: number;
    }>;
    readonly uniqueBlocks: readonly string[];
    readonly truePositiveStatus: 'unclassified' | 'classified';
    readonly metaHealth: GateTelemetryMetaHealth;
}
export declare const canonicalGateCheckRegistry: readonly GateCheckRegistryEntry[];
export declare const canonicalGateTelemetryRequiredNodes: readonly GateTelemetryRequiredNodeCoverage[];
export declare function buildGateTelemetryRegistryCoverageReport(cwd: string): GateTelemetryRegistryCoverageReport;
export declare function buildGateTelemetryTaskSummary(cwd: string, input: {
    readonly taskId: string;
    readonly role?: GateTelemetryTaskSummary['baselineOrTreatmentRole'];
}): GateTelemetryTaskSummary;
export declare function emitGateTelemetryEvent(cwd: string, input: Partial<GateTelemetryEvent> & {
    readonly gate: string;
    readonly checkId: string;
    readonly result: GateTelemetryResult;
}): {
    ok: true;
    event: GateTelemetryEvent;
    path: string;
} | {
    ok: false;
    warning: string;
};
export declare function sealGateTelemetry(cwd: string, input: {
    readonly taskId: string;
    readonly windowId?: string;
    readonly watermark?: string;
}): GateTelemetrySealDigest;
export declare function reportGateTelemetry(cwd: string, includeRuntime?: boolean): GateTelemetryReport;
