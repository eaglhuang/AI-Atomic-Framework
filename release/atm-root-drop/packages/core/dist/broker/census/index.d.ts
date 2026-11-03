export type CensusObservationStatus = 'observed' | 'unavailable';
export type CensusTerminalStatus = 'open' | 'done' | 'blocked' | 'abandoned' | 'unknown';
export type CensusDisposition = 'Fixed' | 'Open' | 'inconclusive';
export interface SharedWriteCensusEntry {
    readonly id: string;
    readonly kind: 'canonical-ticket' | 'bcr' | 'queue' | 'freeze' | 'direction-lock' | 'claim' | 'scope-amendment' | 'runner-sync-reservation' | 'task-terminal-state' | 'closeback' | 'backlog-item' | 'closure-packet';
    readonly authority: string;
    readonly generation: string | null;
    readonly digest: string;
    readonly terminalStatus: CensusTerminalStatus;
    readonly recoveryCommand: string;
    readonly observationStatus: CensusObservationStatus;
    readonly evidenceRef: string;
    readonly ownerCard: string;
}
export interface CurrentSourceDiscriminationProbe {
    readonly backlogId: string;
    readonly probeCommand: string;
    readonly frozenResult: CensusDisposition;
    readonly sourceResult: CensusDisposition;
    readonly ownerCard: string;
    readonly evidenceRef: string;
}
export interface SharedWriteGateCoverage {
    readonly schemaId: 'atm.sharedWriteGateCoverage.v1';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly entries: readonly SharedWriteCensusEntry[];
    readonly currentSourceDiscrimination: readonly CurrentSourceDiscriminationProbe[];
    readonly projectionOnlyItemCount: number;
    readonly unknownOwnerCount: number;
    readonly unavailableReceipts: readonly SharedWriteCensusEntry[];
    readonly digest: string;
}
export interface SharedWriteGateCoverageInput {
    readonly generatedAt?: string;
    readonly entries: readonly Omit<SharedWriteCensusEntry, 'digest'>[];
    readonly currentSourceDiscrimination?: readonly CurrentSourceDiscriminationProbe[];
    readonly projectionOnlyItemCount?: number;
}
export declare function sha256Digest(value: unknown): string;
export declare function buildSharedWriteGateCoverage(input: SharedWriteGateCoverageInput): SharedWriteGateCoverage;
