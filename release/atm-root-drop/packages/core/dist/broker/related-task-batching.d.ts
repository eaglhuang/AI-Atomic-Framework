export type BrokerBatchEvidence = {
    readonly schemaId: 'atm.brokerBatchEvidence.v1';
    readonly batchId: string;
    readonly waveId: string;
    readonly taskIds: readonly string[];
    readonly ticketIds: readonly string[];
    readonly sharedSurfaceFamily: string;
    readonly validators: readonly string[];
    readonly batchRate: number;
    readonly buildsPerWave: number;
};
export type RelatedTaskBatchCandidate = {
    readonly taskId: string;
    readonly ticketId: string;
    readonly waveId: string | null;
    readonly surfaceFamily: string;
    readonly validators?: readonly string[];
};
export declare function buildRelatedTaskBatchEvidence(input: {
    readonly batchId: string;
    readonly candidate: RelatedTaskBatchCandidate | null | undefined;
    readonly candidates: readonly RelatedTaskBatchCandidate[];
}): BrokerBatchEvidence | null;
export declare function inferBrokerSurfaceFamily(values: readonly string[], fallback?: string): string;
export declare function sortedUnique(values: readonly string[]): readonly string[];
