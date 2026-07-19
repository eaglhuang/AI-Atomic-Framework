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
export interface GateTelemetryEvent {
    readonly specVersion: typeof gateTelemetrySpecVersion;
    readonly eventId: string;
    readonly sequence: number;
    readonly observedAt: string;
    readonly gate: string;
    readonly checkId: string;
    readonly checkVersion: string;
    readonly policyVersion: string;
    readonly eligible: boolean;
    readonly result: GateTelemetryResult;
    readonly reasonClass: string;
    readonly durationMs: number;
    readonly actorId: string;
    readonly runId: string;
    readonly correlationId: string;
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
    readonly historyPath: string;
    readonly historyDigest: string;
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
