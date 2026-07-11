export interface BrokerAdmissionExplanation {
    readonly schemaId: 'atm.brokerAdmissionExplanation.v1';
    readonly authority: 'broker-conflict-engine';
    readonly confirmedConflict: boolean;
    readonly mutationIntentStatus: 'not-required' | 'missing' | 'available';
    readonly reason: string;
    readonly conflictKeys: readonly string[];
    readonly adapterExplanations: readonly BrokerAdapterExplanation[];
}
export interface BrokerAdapterExplanation {
    readonly filePath: string;
    readonly adapterId: string;
    readonly conflictSurface: 'projection' | 'owner-shard' | 'json-record' | 'text-range' | 'scalar' | 'file-lock' | 'unknown';
    readonly mutationIntentStatus: 'missing' | 'not-required';
    readonly reason: string;
    readonly canonicalPathHint?: string;
}
export declare function buildBrokerAdmissionExplanation(input: {
    readonly overlappingFiles: readonly string[];
    readonly overlappingAtomIds: readonly string[];
    readonly sharedProjections: readonly string[];
}): BrokerAdmissionExplanation;
export declare function explainBrokerAdapterForPath(filePath: string): BrokerAdapterExplanation[];
export declare function hasUnexplainedSharedProjection(sharedProjections: readonly string[], brokerAdmission: BrokerAdmissionExplanation): boolean;
