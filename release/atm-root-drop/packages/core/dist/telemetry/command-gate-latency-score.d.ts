/**
 * Command/gate latency score: a provider-neutral timing contract that
 * projects existing telemetry receipts into p50/p95, cumulative task-waiting
 * time, and a hotspot ranking. It deliberately consumes existing receipts
 * rather than creating a second telemetry store.
 *
 * Moved here from scripts/plan-performance-report-v4.ts (module-boundaries
 * violation: package runtime must not import from scripts/) so both the
 * packaged CLI (telemetry.ts) and the framework-repo script can share one
 * definition without the published package depending on scripts/.
 */
export type CommandGateLatencyOutcome = 'pass' | 'fail' | 'timeout' | 'cancelled' | 'blocked' | 'unknown';
export type CommandGateLatencySpan = {
    readonly spanId: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly parentSpanId?: string | null;
    readonly phase?: 'startup' | 'queue' | 'scan' | 'io' | 'execution' | 'write' | 'retry' | 'recovery' | 'other';
};
export type CommandGateLatencyInventoryEntry = {
    readonly key: string;
    readonly command: string;
    readonly gate: string;
    readonly mandatory: boolean;
    readonly applicability: string;
};
export type CommandGateLatencySample = {
    readonly sampleId: string;
    readonly key: string;
    readonly command: string;
    readonly gate: string;
    readonly mandatory: boolean;
    readonly applicability: string;
    readonly durationMs: number;
    readonly outcome: CommandGateLatencyOutcome;
    readonly frequency?: number;
    readonly taskId?: string | null;
    readonly runId?: string | null;
    readonly workerId?: string | null;
    readonly spans?: readonly CommandGateLatencySpan[];
    readonly taskInterval?: {
        readonly startMs: number;
        readonly endMs: number;
    };
    readonly evidenceRef?: string | null;
};
/** Structural subset of the existing gate telemetry event used for projection. */
export type CommandGateTelemetryEvent = {
    readonly eventId?: string;
    readonly checkId: string;
    readonly gate: string;
    readonly command?: string;
    readonly durationMs: number;
    readonly result: string;
    readonly taskId?: string | null;
    readonly runId?: string | null;
    readonly evidenceReadRef?: string | null;
};
export type CommandGateLatencyScore = {
    readonly key: string;
    readonly command: string;
    readonly gate: string;
    readonly mandatory: boolean;
    readonly applicability: string;
    readonly sampleCount: number;
    readonly frequency: number;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
    readonly inclusiveMs: number | null;
    readonly exclusiveMs: number | null;
    readonly cumulativeTaskWaitingMs: number | null;
    readonly failureCount: number;
    readonly timeoutCount: number;
    readonly retryCount: number;
    readonly recoveryCount: number;
    readonly measured: boolean;
    readonly evidenceRefs: readonly string[];
};
export type CommandGateLatencyReport = {
    readonly schemaId: 'atm.commandGateLatencyScore.v1';
    readonly generatedAt: string;
    readonly inventoryCount: number;
    readonly observedCount: number;
    readonly coveragePct: number;
    readonly uncoveredKeys: readonly string[];
    readonly unknownKeys: readonly string[];
    readonly mandatoryTaskWaitingP50Ms: number | null;
    readonly mandatoryTaskWaitingP95Ms: number | null;
    readonly measurementOverheadMs: number | null;
    readonly scores: readonly CommandGateLatencyScore[];
    readonly hotspots: readonly CommandGateLatencyScore[];
};
/** Return the length of the union of half-open intervals, without double-counting nested spans. */
export declare function unionIntervalsMs(intervals: readonly {
    readonly startMs: number;
    readonly endMs: number;
}[]): number;
export declare function buildCommandGateLatencyReport(input: {
    readonly inventory: readonly CommandGateLatencyInventoryEntry[];
    readonly samples: readonly CommandGateLatencySample[];
    readonly generatedAt?: string;
    readonly measurementOverheadMs?: number | null;
}): CommandGateLatencyReport;
/**
 * Project the already-recorded gate telemetry events into the latency score.
 * This keeps the event stream as the sole source of truth; no second store is
 * created and absent runtime events remain unknown.
 */
export declare function buildCommandGateLatencyReportFromEvents(input: {
    readonly inventory: readonly CommandGateLatencyInventoryEntry[];
    readonly events: readonly CommandGateTelemetryEvent[];
    readonly mandatoryKeys?: readonly string[];
    readonly generatedAt?: string;
    readonly measurementOverheadMs?: number | null;
}): CommandGateLatencyReport;
export declare function validateCommandGateLatencyReport(report: CommandGateLatencyReport): readonly string[];
export declare function compareCommandGateLatencyReports(baseline: CommandGateLatencyReport, candidate: CommandGateLatencyReport): {
    readonly mandatoryWaitingP50DeltaMs: number | null;
    readonly mandatoryWaitingP50ReductionPct: number | null;
    readonly mandatoryWaitingP95RegressionPct: number | null;
    readonly verdict: 'pass' | 'fail' | 'inconclusive';
};
export declare function buildCommandGateLatencyMarkdown(report: CommandGateLatencyReport): string;
