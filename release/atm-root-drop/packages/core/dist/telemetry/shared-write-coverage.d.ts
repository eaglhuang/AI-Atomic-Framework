import { type GateTelemetryCoverageStatus, type GateTelemetrySourceAvailability } from './index.ts';
export interface SharedWriteGateCoverageProducer {
    readonly checkId: string;
    readonly owner: string;
    readonly status: GateTelemetryCoverageStatus;
    readonly sourceAvailability: GateTelemetrySourceAvailability;
    readonly receiptRef: string | null;
}
export interface SharedWriteGateCoverageReport {
    readonly schemaId: 'atm.sharedWriteGateCoverage.v1';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none';
        readonly fromVersion: null;
        readonly notes: string;
    };
    readonly generatedAt: string;
    readonly producerCount: number;
    readonly observedProducerCount: number;
    readonly coveragePercentage: number;
    readonly producers: readonly SharedWriteGateCoverageProducer[];
    readonly unavailableReceipts: readonly {
        readonly checkId: string;
        readonly receiptRef: string;
        readonly reason: string;
    }[];
    readonly inputDigest: string;
    readonly sealedDigest: string;
}
export declare function buildSharedWriteGateCoverageReport(cwd: string): SharedWriteGateCoverageReport;
