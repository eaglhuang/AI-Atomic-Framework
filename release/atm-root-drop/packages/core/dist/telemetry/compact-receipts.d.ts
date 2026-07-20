import type { GateTelemetryReport, GateTelemetrySealDigest, GateTelemetryTaskSummary } from './index.ts';
export declare function readCompactSealDigests(root: string): GateTelemetrySealDigest[];
export declare function reportFromCompactSeals(seals: readonly GateTelemetrySealDigest[], malformedEvents: number, warnings: readonly string[]): GateTelemetryReport;
export declare function mergeReports(left: GateTelemetryReport, right: GateTelemetryReport, source: GateTelemetryReport['source']): GateTelemetryReport;
export declare function mergeCompactCorrelation(seals: readonly GateTelemetrySealDigest[]): GateTelemetryTaskSummary['correlation'];
