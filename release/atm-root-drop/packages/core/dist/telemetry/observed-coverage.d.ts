import type { GateCheckRegistryEntry, GateTelemetryEvent, GateTelemetryRegistryCoverageReport, GateTelemetryRequiredNodeCoverage } from './index.js';
export interface GateTelemetryEventRead {
    readonly valid: readonly GateTelemetryEvent[];
    readonly malformed: number;
}
export interface EligibleRuntimeEventSelection {
    readonly events: readonly GateTelemetryEvent[];
    readonly excludedIneligibleCount: number;
    readonly excludedBySource: Readonly<Record<string, number>>;
    readonly duplicateEventIdCount: number;
    readonly invalidEventIdCount: number;
}
export declare function buildObservedCoverageReport(input: {
    readonly historyEvents: GateTelemetryEventRead;
    readonly runtimeEvents: GateTelemetryEventRead;
    readonly requiredNodes: readonly GateTelemetryRequiredNodeCoverage[];
    readonly checks: readonly GateCheckRegistryEntry[];
    readonly digest: (value: unknown) => string;
}): GateTelemetryRegistryCoverageReport;
export declare function selectEligibleRuntimeEvents(events: readonly GateTelemetryEvent[]): EligibleRuntimeEventSelection;
export declare function assessObservedNodeCoverage(node: GateTelemetryRequiredNodeCoverage, observedEvents: readonly GateTelemetryEvent[], malformedEventCount?: number): GateTelemetryRequiredNodeCoverage;
