interface MetricsInput {
    total?: number;
    totalCount?: number;
    failed?: number;
    failedCount?: number;
    latency?: number;
    durationMs?: number;
    propagationDuration?: number;
    coverage?: number | null;
    edgeCaseCount?: number;
}
export declare function createTestReportMetrics(input: MetricsInput | null | undefined): {
    latency: number;
    errorRate: number;
    coverage: number | null;
    edgeCaseCount: number;
};
export {};
