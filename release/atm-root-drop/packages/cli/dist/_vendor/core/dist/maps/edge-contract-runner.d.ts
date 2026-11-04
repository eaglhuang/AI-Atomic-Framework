export interface EdgeContractResult {
    edge: {
        from: string;
        to: string;
        binding: string;
    };
    passed: boolean;
    reason: string;
    fromOutputSchema: unknown;
    toInputSchema: unknown;
}
export interface EdgeContractReport {
    schemaId: 'atm.edgeContractReport';
    mapId: string;
    checkedAt: string;
    totalEdges: number;
    passed: number;
    failed: number;
    results: EdgeContractResult[];
}
export declare function runEdgeContractCheck(repositoryRoot: string, mapId: string): EdgeContractReport;
